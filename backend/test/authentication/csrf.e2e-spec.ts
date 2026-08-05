import { randomUUID } from 'node:crypto';

import type { ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { Pool } from 'pg';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { buildValidationPipe } from '../../src/bootstrap';
import type { ApiEnvelope } from '../../src/common/api';
import { applicationConfig } from '../../src/config/application.config';
import { cookiesConfig } from '../../src/config/cookies.config';
import { PasswordHasher } from '../../src/modules/identity/passwords/domain/password-hasher';
import {
  cookieValue,
  csrfOf,
  preSessionCsrf,
  resetRateLimits,
} from '../helpers';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

const PASSWORD = 'correct horse battery staple';

describeWithDatabase('CSRF protection', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let names: { access: string; refresh: string; csrf: string; context: string };
  let allowedOrigin: string;

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);
  const suffix = unique();
  const ids = { org: `org_c${suffix}`, user: `usr_c${suffix}` };
  const email = `csrf.${suffix}@eventini.test`;

  const server = () => app.getHttpServer();

  const login = () => request(server()).post('/api/v1/auth/sessions');

  const credentials = { email, password: PASSWORD, clientType: 'WEB' };

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: false,
    });

    const cookies = app.get<ConfigType<typeof cookiesConfig>>(
      cookiesConfig.KEY,
    );
    names = {
      access: cookies.access.name,
      refresh: cookies.refresh.name,
      csrf: cookies.csrf.name,
      context: cookies.csrfContext.name,
    };
    allowedOrigin = app.get<ConfigType<typeof applicationConfig>>(
      applicationConfig.KEY,
    ).corsAllowedOrigins[0] as string;

    app.use(cookieParser(cookies.secret));
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();

    const hash = await app
      .get(PasswordHasher, { strict: false })
      .hash(PASSWORD);

    pool = new Pool({ connectionString: DATABASE_URL, max: 3 });
    pool.on('error', () => undefined);

    await pool.query(
      `INSERT INTO organizations (id, name, slug, status, license_plan, is_enabled, updated_at)
       VALUES ($1, 'C', $2, 'ACTIVE', 'free', true, now())`,
      [ids.org, `c-${suffix}`],
    );
    await pool.query(
      `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
       VALUES ($1, $2, $2, 'A', 'B', 'ACTIVE', now())`,
      [ids.user, email],
    );
    await pool.query(
      `INSERT INTO user_credentials (id, user_id, password_hash, updated_at)
       VALUES ($1, $2, $3, now())`,
      [`cred_${unique()}`, ids.user, hash],
    );
    await pool.query(
      `INSERT INTO organization_memberships (id, user_id, organization_id, status, updated_at)
       VALUES ($1, $2, $3, 'ACTIVE', now())`,
      [`mbr_${unique()}`, ids.user, ids.org],
    );
  });

  // The limiter is shared state: without this a suite that signs in many times
  // exhausts the per-IP login window and fails for a reason that has nothing
  // to do with what it is testing. See `resetRateLimits`.
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
        [ids.user],
      );
      await purge.query('COMMIT');
    } finally {
      purge.release();
    }

    await pool.query(`DELETE FROM user_sessions WHERE user_id = $1`, [
      ids.user,
    ]);
    await pool.query(
      `DELETE FROM organization_memberships WHERE user_id = $1`,
      [ids.user],
    );
    await pool.query(`DELETE FROM user_credentials WHERE user_id = $1`, [
      ids.user,
    ]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [ids.user]);
    await pool.query(`DELETE FROM organizations WHERE id = $1`, [ids.org]);

    await pool.end();
    await app.close();
  });

  describe('GET /auth/csrf-token', () => {
    it('mints a token and its HttpOnly context without any session', async () => {
      const response = await request(server())
        .get('/api/v1/auth/csrf-token')
        .expect(200);

      const body = (
        response.body as ApiEnvelope<{ token: string; headerName: string }>
      ).data!;

      expect(body.token).toEqual(expect.any(String));
      expect(body.headerName).toBe('X-CSRF-Token');
      expect(cookieValue(response, names.context)).toBeDefined();
      expect(cookieValue(response, names.csrf)).toBeDefined();
    });

    /**
     * The readable half must stay readable — the whole double-submit pattern
     * depends on JavaScript being able to echo it into a header. The context
     * half is the one that must not be.
     */
    it('keeps the context HttpOnly and the token readable', async () => {
      const response = await request(server()).get('/api/v1/auth/csrf-token');
      const raw = (response.headers['set-cookie'] ?? []) as unknown as string[];

      // Matched on `name=`, not `name`: `__Host-eventini_csrf` is a prefix of
      // `__Host-eventini_csrf_ctx`, so a `startsWith` on the bare name finds
      // whichever cookie happens to come first.
      const context = raw.find((c) => c.startsWith(`${names.context}=`));
      const token = raw.find((c) => c.startsWith(`${names.csrf}=`));

      expect(context).toMatch(/HttpOnly/i);
      expect(token).toBeDefined();
      expect(token).not.toMatch(/HttpOnly/i);
    });
  });

  /** 🔴 The four negative tests the ticket makes mandatory. */
  describe('the guard', () => {
    /**
     * An allowed `Origin` is sent deliberately: the guard checks the origin
     * first, so omitting both would prove only that the origin check runs.
     * This isolates the missing token as the sole reason for the refusal.
     */
    it('refuses a POST with no X-CSRF-Token', async () => {
      const response = await login()
        .set('Origin', allowedOrigin)
        .send(credentials)
        .expect(403);

      expect((response.body as ApiEnvelope<null>).error?.code).toBe(
        'AUTH_CSRF_INVALID',
      );
    });

    it('refuses a POST with no Origin at all', async () => {
      const response = await login().send(credentials).expect(403);

      expect((response.body as ApiEnvelope<null>).error?.code).toBe(
        'AUTH_ORIGIN_DENIED',
      );
    });

    it('refuses a token bound to a different context', async () => {
      const handshake = () =>
        request(server()).get('/api/v1/auth/csrf-token').expect(200);

      const mine = await handshake();
      const other = await handshake();

      // My token, someone else's context cookie. Each half is individually
      // valid and freshly minted; only the pairing is wrong, which is exactly
      // what the binding exists to detect.
      const response = await login()
        .set('Origin', allowedOrigin)
        .set('X-CSRF-Token', cookieValue(mine, names.csrf) as string)
        .set(
          'Cookie',
          `${names.context}=${cookieValue(other, names.context) as string}`,
        )
        .send(credentials);

      expect(response.status).toBe(403);
      expect((response.body as ApiEnvelope<null>).error?.code).toBe(
        'AUTH_CSRF_INVALID',
      );
    });

    it('refuses a header that does not match the cookie', async () => {
      const csrf = await preSessionCsrf(app);
      const headers = csrf.headers();

      const response = await login()
        .set({ ...headers, 'X-CSRF-Token': `${csrf.token}tampered` })
        .send(credentials);

      expect(response.status).toBe(403);
      expect((response.body as ApiEnvelope<null>).error?.code).toBe(
        'AUTH_CSRF_INVALID',
      );
    });

    it('refuses a disallowed Origin', async () => {
      const csrf = await preSessionCsrf(app);

      const response = await login()
        .set({ ...csrf.headers(), Origin: 'https://attacker.example' })
        .send(credentials);

      expect(response.status).toBe(403);
      expect((response.body as ApiEnvelope<null>).error?.code).toBe(
        'AUTH_ORIGIN_DENIED',
      );
    });

    it('lets a well-formed pre-session request through to the credentials', async () => {
      const csrf = await preSessionCsrf(app);

      await login().set(csrf.headers()).send(credentials).expect(201);
    });
  });

  /**
   * 🔴 ADR-0016's reason for existing. A token captured before login must not
   * survive it, or the pre-session mode would be a way to pre-arm a token for
   * an authenticated victim.
   */
  describe('rebinding at login', () => {
    it('replaces the anonymous context with one naming the session', async () => {
      const csrf = await preSessionCsrf(app);
      const response = await login()
        .set(csrf.headers())
        .send(credentials)
        .expect(201);

      const rebound = cookieValue(response, names.csrf);

      expect(rebound).toBeDefined();
      expect(rebound).not.toBe(csrf.token);
      expect(cookieValue(response, names.context)).toBeDefined();
    });

    it('refuses the pre-session token once it has been spent on a login', async () => {
      const csrf = await preSessionCsrf(app);
      const session = await login()
        .set(csrf.headers())
        .send(credentials)
        .expect(201);

      const sessionCookies = `${names.access}=${cookieValue(session, names.access)}; ${names.refresh}=${cookieValue(session, names.refresh)}`;

      // The stale pre-session pair, now presented alongside a real session.
      const replay = await request(server())
        .delete('/api/v1/auth/sessions/current')
        .set(csrf.headers(sessionCookies))
        .send();

      expect(replay.status).toBe(403);
      expect((replay.body as ApiEnvelope<null>).error?.code).toBe(
        'AUTH_CSRF_INVALID',
      );
    });

    it('accepts the rebound token for an authenticated mutation', async () => {
      const csrf = await preSessionCsrf(app);
      const session = await login()
        .set(csrf.headers())
        .send(credentials)
        .expect(201);

      const rebound = csrfOf(app, session);
      const sessionCookies = `${names.access}=${cookieValue(session, names.access)}; ${names.refresh}=${cookieValue(session, names.refresh)}`;

      await request(server())
        .delete('/api/v1/auth/sessions/current')
        .set(rebound.headers(sessionCookies))
        .send()
        .expect(204);
    });
  });

  describe('exemptions', () => {
    it('leaves the health probes reachable without a token', async () => {
      await request(server()).get('/api/v1/health/live').expect(200);
    });
  });
});
