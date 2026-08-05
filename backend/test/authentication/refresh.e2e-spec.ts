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
import { cookiesConfig } from '../../src/config/cookies.config';
import { PasswordHasher } from '../../src/modules/identity/passwords/domain/password-hasher';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

const PASSWORD = 'correct horse battery staple';
const ROTATE = '/api/v1/auth/sessions/current/rotation';

describeWithDatabase('POST /api/v1/auth/sessions/current/rotation', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let refreshCookieName: string;

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);
  const suffix = unique();
  const org = `org_${suffix}`;
  const user = `usr_${suffix}`;
  const email = `rotate.${suffix}@eventini.test`;

  function cookieValue(
    response: request.Response,
    name: string,
  ): string | undefined {
    const cookies = (response.headers['set-cookie'] ??
      []) as unknown as string[];

    return cookies
      .map((cookie) => {
        const [pair] = cookie.split(';');

        return pair?.startsWith(`${name}=`)
          ? pair.slice(name.length + 1)
          : undefined;
      })
      .find((value): value is string => value !== undefined);
  }

  /** A fresh session, returning its first refresh token. */
  async function newSession(): Promise<{ token: string; sessionId: string }> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/sessions')
      .send({ email, password: PASSWORD, clientType: 'WEB' });

    expect(response.status).toBe(201);

    return {
      token: cookieValue(response, refreshCookieName) as string,
      sessionId: (response.body as ApiEnvelope<{ sessionId: string }>).data
        ?.sessionId as string,
    };
  }

  function rotate(token: string) {
    return request(app.getHttpServer())
      .post(ROTATE)
      .set('Cookie', `${refreshCookieName}=${token}`);
  }

  async function rowsOfFamily(sessionId: string) {
    const result = await pool.query<{ status: string }>(
      `SELECT status FROM refresh_token_rotations WHERE session_id = $1 ORDER BY issued_at`,
      [sessionId],
    );

    return result.rows.map((row) => row.status);
  }

  async function sessionStatus(sessionId: string): Promise<string | undefined> {
    const result = await pool.query<{ status: string }>(
      `SELECT status FROM user_sessions WHERE id = $1`,
      [sessionId],
    );

    return result.rows[0]?.status;
  }

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: false,
    });
    const cookies = app.get<ConfigType<typeof cookiesConfig>>(
      cookiesConfig.KEY,
    );
    refreshCookieName = cookies.refresh.name;

    app.use(cookieParser(cookies.secret));
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();

    const hash = await app
      .get(PasswordHasher, { strict: false })
      .hash(PASSWORD);

    pool = new Pool({ connectionString: DATABASE_URL, max: 5 });
    pool.on('error', () => undefined);

    await pool.query(
      `INSERT INTO organizations (id, name, slug, status, license_plan, is_enabled, updated_at)
       VALUES ($1, 'R', $2, 'ACTIVE', 'free', true, now())`,
      [org, `r-${suffix}`],
    );
    await pool.query(
      `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
       VALUES ($1, $2, $2, 'R', 'R', 'ACTIVE', now())`,
      [user, email],
    );
    await pool.query(
      `INSERT INTO user_credentials (id, user_id, password_hash, updated_at)
       VALUES ($1, $2, $3, now())`,
      [`cred_${suffix}`, user, hash],
    );
    await pool.query(
      `INSERT INTO organization_memberships (id, user_id, organization_id, status, updated_at)
       VALUES ($1, $2, $3, 'ACTIVE', now())`,
      [`mbr_${suffix}`, user, org],
    );
  });

  afterAll(async () => {
    const purge = await pool.connect();
    try {
      await purge.query('BEGIN');
      await purge.query("SET LOCAL eventini.retention_purge = 'on'");
      await purge.query(
        `DELETE FROM refresh_token_rotations
          WHERE session_id IN (SELECT id FROM user_sessions WHERE user_id = $1)`,
        [user],
      );
      await purge.query('COMMIT');
    } finally {
      purge.release();
    }

    await pool.query(`DELETE FROM user_sessions WHERE user_id = $1`, [user]);
    await pool.query(
      `DELETE FROM organization_memberships WHERE user_id = $1`,
      [user],
    );
    await pool.query(`DELETE FROM user_credentials WHERE user_id = $1`, [user]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [user]);
    await pool.query(`DELETE FROM organizations WHERE id = $1`, [org]);

    await pool.end();
    await app.close();
  });

  describe('a valid rotation', () => {
    it('issues a new pair and consumes the old token', async () => {
      const { token, sessionId } = await newSession();

      const response = await rotate(token);

      expect(response.status).toBe(200);
      expect(cookieValue(response, refreshCookieName)).not.toBe(token);
      expect(await rowsOfFamily(sessionId)).toEqual(['CONSUMED', 'ACTIVE']);
    });

    it('chains the new token to the one it replaced', async () => {
      const { token, sessionId } = await newSession();
      await rotate(token);

      const chain = await pool.query<{
        id: string;
        previous_token_id: string | null;
        replaced_by_token_id: string | null;
      }>(
        `SELECT id, previous_token_id, replaced_by_token_id
           FROM refresh_token_rotations WHERE session_id = $1 ORDER BY issued_at`,
        [sessionId],
      );

      const [first, second] = chain.rows;

      expect(first?.replaced_by_token_id).toBe(second?.id);
      expect(second?.previous_token_id).toBe(first?.id);
    });

    it('keeps one family across several rotations', async () => {
      const session = await newSession();
      let token = session.token;

      for (let i = 0; i < 3; i += 1) {
        const response = await rotate(token);
        expect(response.status).toBe(200);
        token = cookieValue(response, refreshCookieName) as string;
      }

      // Scoped to this session: every login starts its own family, so
      // counting across the user would count the other tests' sessions too.
      const families = await pool.query<{ count: string }>(
        `SELECT count(DISTINCT token_family_id) AS count
           FROM refresh_token_rotations WHERE session_id = $1`,
        [session.sessionId],
      );

      expect(Number(families.rows[0]?.count)).toBe(1);
      expect(await rowsOfFamily(session.sessionId)).toEqual([
        'CONSUMED',
        'CONSUMED',
        'CONSUMED',
        'ACTIVE',
      ]);
    });

    /**
     * 🔴 The rule that stops a session living forever by being used forever.
     */
    it('pushes the idle deadline forward and never the absolute one', async () => {
      const { token, sessionId } = await newSession();

      const before = await pool.query<{
        idle_expires_at: Date;
        absolute_expires_at: Date;
      }>(
        `SELECT idle_expires_at, absolute_expires_at FROM user_sessions WHERE id = $1`,
        [sessionId],
      );

      await new Promise((resolve) => setTimeout(resolve, 1100));
      await rotate(token);

      const after = await pool.query<{
        idle_expires_at: Date;
        absolute_expires_at: Date;
      }>(
        `SELECT idle_expires_at, absolute_expires_at FROM user_sessions WHERE id = $1`,
        [sessionId],
      );

      expect(after.rows[0]!.idle_expires_at.getTime()).toBeGreaterThan(
        before.rows[0]!.idle_expires_at.getTime(),
      );
      expect(after.rows[0]!.absolute_expires_at.getTime()).toBe(
        before.rows[0]!.absolute_expires_at.getTime(),
      );
    });
  });

  /**
   * 🔴 §5.3. The whole family falls, not only the replayed token: which of the
   * two holders is legitimate is unknowable, so both lose access. The victim
   * signs in again; the attacker cannot.
   */
  describe('replay detection', () => {
    it('revokes the entire family and compromises the session', async () => {
      const { token, sessionId } = await newSession();
      await rotate(token);

      const replay = await rotate(token);

      expect(replay.status).toBe(401);
      expect((replay.body as ApiEnvelope<never>).error?.code).toBe(
        'AUTH_REFRESH_REUSE_DETECTED',
      );
      expect(await rowsOfFamily(sessionId)).toEqual(['REUSED', 'REVOKED']);
      expect(await sessionStatus(sessionId)).toBe('COMPROMISED');
    });

    it('issues no token when it detects a replay', async () => {
      const { token, sessionId } = await newSession();
      await rotate(token);

      const replay = await rotate(token);
      const active = await pool.query<{ count: string }>(
        `SELECT count(*) AS count FROM refresh_token_rotations
          WHERE session_id = $1 AND status = 'ACTIVE'`,
        [sessionId],
      );

      expect(Number(active.rows[0]?.count)).toBe(0);
      expect(cookieValue(replay, refreshCookieName)).toBe('');
    });

    /** The successor is dead too, so the legitimate holder is locked out. */
    it('kills the token the attacker did not have', async () => {
      const { token } = await newSession();
      const rotated = await rotate(token);
      const successor = cookieValue(rotated, refreshCookieName) as string;

      await rotate(token);

      const afterReplay = await rotate(successor);

      expect(afterReplay.status).toBe(401);
    });

    it('refuses a token nobody ever issued', async () => {
      const response = await rotate('not-a-real-token');

      expect(response.status).toBe(401);
      expect((response.body as ApiEnvelope<never>).error?.code).toBe(
        'AUTHENTICATION_REQUIRED',
      );
    });

    it('refuses a request with no refresh cookie', async () => {
      const response = await request(app.getHttpServer()).post(ROTATE);

      expect(response.status).toBe(401);
    });
  });

  /**
   * 🔴 Two rotations with the same token, in flight together. They are
   * separated by `ux_refresh_active_per_family`, not by an application lock:
   * a Redis lock coordinates, a PostgreSQL constraint guarantees.
   */
  describe('concurrency', () => {
    it('lets exactly one of two simultaneous rotations win', async () => {
      const { token, sessionId } = await newSession();

      const [first, second] = await Promise.all([rotate(token), rotate(token)]);

      const statuses = [first.status, second.status].sort();

      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      expect(statuses).toEqual([200, 409]);

      const rows = await rowsOfFamily(sessionId);

      expect(rows.filter((status) => status === 'ACTIVE')).toHaveLength(1);
    });

    it('does not treat the loser of a race as an attacker', async () => {
      const { token, sessionId } = await newSession();

      await Promise.all([rotate(token), rotate(token)]);

      // A replay would have marked the session COMPROMISED. Losing a race is
      // an ordinary outcome, not an incident.
      expect(await sessionStatus(sessionId)).toBe('ACTIVE');
      expect(await rowsOfFamily(sessionId)).not.toContain('REUSED');
    });

    it('leaves one usable token after a race', async () => {
      const { token } = await newSession();

      const results = await Promise.all([rotate(token), rotate(token)]);
      const winner = results.find((response) => response.status === 200);
      const next = cookieValue(winner as request.Response, refreshCookieName);

      await expect(rotate(next as string)).resolves.toMatchObject({
        status: 200,
      });
    });
  });

  describe('a session that has run out of time', () => {
    it('refuses a rotation past the idle deadline', async () => {
      const { token, sessionId } = await newSession();

      await pool.query(
        `UPDATE user_sessions SET idle_expires_at = now() - interval '1 minute' WHERE id = $1`,
        [sessionId],
      );

      const response = await rotate(token);

      expect(response.status).toBe(401);
      expect((response.body as ApiEnvelope<never>).error?.code).toBe(
        'AUTH_SESSION_EXPIRED',
      );
    });

    /** Valid refresh token, continuous activity, and it still ends. */
    it('refuses a rotation past the absolute deadline', async () => {
      const { token, sessionId } = await newSession();

      await pool.query(
        `UPDATE user_sessions
            SET idle_expires_at = now() - interval '2 minutes',
                absolute_expires_at = now() - interval '1 minute'
          WHERE id = $1`,
        [sessionId],
      );

      const response = await rotate(token);

      expect(response.status).toBe(401);
    });

    it('refuses a rotation on a revoked session', async () => {
      const { token, sessionId } = await newSession();

      await pool.query(
        `UPDATE user_sessions SET status = 'REVOKED', revoked_at = now() WHERE id = $1`,
        [sessionId],
      );

      const response = await rotate(token);

      expect(response.status).toBe(401);
      expect((response.body as ApiEnvelope<never>).error?.code).toBe(
        'AUTH_SESSION_REVOKED',
      );
    });

    it('refuses a refresh token that has expired on its own', async () => {
      const { token, sessionId } = await newSession();

      await pool.query(
        `UPDATE refresh_token_rotations
            SET expires_at = now() - interval '1 minute'
          WHERE session_id = $1 AND status = 'ACTIVE'`,
        [sessionId],
      );

      const response = await rotate(token);

      expect(response.status).toBe(401);
    });
  });
});
