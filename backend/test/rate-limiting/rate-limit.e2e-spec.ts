import { randomUUID } from 'node:crypto';

import type { ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { Pool } from 'pg';
import { createClient } from 'redis';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { buildValidationPipe } from '../../src/bootstrap';
import type { ApiEnvelope } from '../../src/common/api';
import { applicationConfig } from '../../src/config/application.config';
import { cookiesConfig } from '../../src/config/cookies.config';
import { rateLimitConfig } from '../../src/config/rate-limit.config';
import { PasswordHasher } from '../../src/modules/identity/passwords/domain/password-hasher';
import { preSessionCsrf, resetRateLimits, type Csrf } from '../helpers';

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const describeWithServices =
  DATABASE_URL && REDIS_URL ? describe : describe.skip;

const PASSWORD = 'correct horse battery staple';

describeWithServices('rate limiting and lockout', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let redis: ReturnType<typeof createClient>;
  let anon: Csrf;
  let loginLimit: number;

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);
  const suffix = unique();
  const ids = { org: `org_r${suffix}`, victim: `usr_v${suffix}` };
  const victimEmail = `victim.${suffix}@eventini.test`;

  const server = () => app.getHttpServer();

  /**
   * A distinct forged `X-Forwarded-For` per test, so one test's counters never
   * leak into another's. `trust proxy` is configured with a hop count, so this
   * header is honoured here exactly as a real proxy's would be.
   */
  const fromIp = (ip: string) => ({
    ...anon.headers(),
    'X-Forwarded-For': ip,
  });

  const attempt = (email: string, password: string, ip: string) =>
    request(server())
      .post('/api/v1/auth/sessions')
      .set(fromIp(ip))
      .send({ email, password, clientType: 'WEB' });

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: false,
    });

    const cookies = app.get<ConfigType<typeof cookiesConfig>>(
      cookiesConfig.KEY,
    );
    const application = app.get<ConfigType<typeof applicationConfig>>(
      applicationConfig.KEY,
    );
    loginLimit = app.get<ConfigType<typeof rateLimitConfig>>(
      rateLimitConfig.KEY,
    ).login.perIpAndEmail;

    app.set('trust proxy', application.trustedProxyHops);
    app.use(cookieParser(cookies.secret));
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();

    anon = await preSessionCsrf(app);

    const hash = await app
      .get(PasswordHasher, { strict: false })
      .hash(PASSWORD);

    pool = new Pool({ connectionString: DATABASE_URL, max: 3 });
    pool.on('error', () => undefined);

    redis = createClient({ url: REDIS_URL });
    redis.on('error', () => undefined);
    await redis.connect();

    await pool.query(
      `INSERT INTO organizations (id, name, slug, status, license_plan, is_enabled, updated_at)
       VALUES ($1, 'R', $2, 'ACTIVE', 'free', true, now())`,
      [ids.org, `r-${suffix}`],
    );
    await pool.query(
      `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
       VALUES ($1, $2, $2, 'V', 'V', 'ACTIVE', now())`,
      [ids.victim, victimEmail],
    );
    await pool.query(
      `INSERT INTO user_credentials (id, user_id, password_hash, updated_at)
       VALUES ($1, $2, $3, now())`,
      [`cred_${unique()}`, ids.victim, hash],
    );
    await pool.query(
      `INSERT INTO organization_memberships (id, user_id, organization_id, status, updated_at)
       VALUES ($1, $2, $3, 'ACTIVE', now())`,
      [`mbr_${unique()}`, ids.victim, ids.org],
    );
  });

  /**
   * Each test builds its window from zero. Without this the counters survive
   * between tests and across whole runs, so the second run of the suite would
   * start already refused — the tests would depend on the order they happened
   * to execute in, which is the opposite of what a limiter test should prove.
   */
  beforeEach(async () => {
    await resetRateLimits();
  });

  afterAll(async () => {
    const purge = await pool.connect();
    try {
      await purge.query('BEGIN');
      await purge.query("SET LOCAL eventini.retention_purge = 'on'");
      await purge.query(
        `DELETE FROM refresh_token_rotations
          WHERE session_id IN (SELECT id FROM user_sessions WHERE user_id = $1)`,
        [ids.victim],
      );
      await purge.query('COMMIT');
    } finally {
      purge.release();
    }

    await pool.query(`DELETE FROM user_sessions WHERE user_id = $1`, [
      ids.victim,
    ]);
    await pool.query(
      `DELETE FROM organization_memberships WHERE user_id = $1`,
      [ids.victim],
    );
    await pool.query(`DELETE FROM user_credentials WHERE user_id = $1`, [
      ids.victim,
    ]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [ids.victim]);
    await pool.query(`DELETE FROM organizations WHERE id = $1`, [ids.org]);

    await pool.end();
    await redis.quit();
    await app.close();
  });

  describe('the login window', () => {
    it('refuses the attempt past the ceiling with 429', async () => {
      const ip = '198.51.100.11';
      const email = `nobody.${unique()}@eventini.test`;

      for (let index = 0; index < loginLimit; index += 1) {
        const response = await attempt(email, 'wrong', ip);
        expect(response.status).toBe(401);
      }

      const refused = await attempt(email, 'wrong', ip);

      expect(refused.status).toBe(429);
      expect((refused.body as ApiEnvelope<null>).error?.code).toBe(
        'RATE_LIMIT_EXCEEDED',
      );
    });

    it('answers with Retry-After and the RateLimit headers', async () => {
      const ip = '198.51.100.12';
      const email = `nobody.${unique()}@eventini.test`;

      for (let index = 0; index <= loginLimit; index += 1) {
        await attempt(email, 'wrong', ip);
      }

      const refused = await attempt(email, 'wrong', ip);

      expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(refused.headers['ratelimit-limit']).toBeDefined();
      expect(refused.headers['ratelimit-remaining']).toBe('0');
    });

    /** Naming the dimension would confirm the address belongs to an account. */
    it('never says which dimension was exceeded', async () => {
      const ip = '198.51.100.13';
      const email = `nobody.${unique()}@eventini.test`;

      for (let index = 0; index <= loginLimit; index += 1) {
        await attempt(email, 'wrong', ip);
      }

      const refused = await attempt(email, 'wrong', ip);
      const raw = JSON.stringify(refused.body).toLowerCase();

      expect(raw).not.toContain('email');
      expect(raw).not.toContain('ip');
      expect(raw).not.toContain(email.toLowerCase());
    });
  });

  /**
   * 🔴 The single most important test in this sprint — §5.2.
   *
   * Keying the lockout on the email alone would let anyone lock any account
   * out by failing five times against an address they know: the control
   * becomes a free, remote denial of service against the victim. Keying on
   * ip+email means the attacker locks out only themselves.
   */
  describe('an attacker cannot lock out a victim', () => {
    it('leaves the victim able to sign in from their own address', async () => {
      const attackerIp = '203.0.113.66';
      const victimIp = '198.51.100.200';

      // Well past the ladder's first rung, all against the victim's address.
      for (let index = 0; index < 10; index += 1) {
        await attempt(victimEmail, 'not the password', attackerIp);
      }

      // Both halves must hold, or the test proves nothing. If the attacker is
      // not actually stopped, a limiter that did nothing at all would still
      // let the victim in and the test would pass vacuously.
      const attacker = await attempt(
        victimEmail,
        'not the password',
        attackerIp,
      );
      expect(attacker.status).toBe(429);

      // The victim, from their own IP, with the right password.
      const victim = await attempt(victimEmail, PASSWORD, victimIp);

      expect(victim.status).toBe(201);
    });
  });

  describe('the trusted proxy boundary', () => {
    /**
     * `trust proxy` is a hop count, so the header is only honoured from a
     * declared proxy. Were it read blindly, a forged value per request would
     * walk past every per-IP limit — §7.6 calls this the most common mistake
     * in rate limiter implementations.
     */
    it('counts a forged X-Forwarded-For chain against one key, not many', async () => {
      const email = `nobody.${unique()}@eventini.test`;
      const responses: number[] = [];

      for (let index = 0; index <= loginLimit + 1; index += 1) {
        const response = await request(server())
          .post('/api/v1/auth/sessions')
          // A different forged hop each time, appended beyond the trusted
          // count: the real peer is what must be counted.
          .set({
            ...anon.headers(),
            'X-Forwarded-For': `10.0.0.${String(index)}, 198.51.100.14`,
          })
          .send({ email, password: 'wrong', clientType: 'WEB' });

        responses.push(response.status);
      }

      expect(responses).toContain(429);
    });
  });

  describe('exemptions', () => {
    it('never limits the health probe', async () => {
      for (let index = 0; index < 20; index += 1) {
        await request(server()).get('/api/v1/health/live').expect(200);
      }
    });
  });
});
