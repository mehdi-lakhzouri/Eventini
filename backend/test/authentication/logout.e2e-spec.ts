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
const SESSIONS = '/api/v1/auth/sessions';

describeWithDatabase('session revocation', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let names: { access: string; refresh: string };

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);
  const suffix = unique();
  const org = `org_${suffix}`;
  const user = `usr_${suffix}`;
  const email = `logout.${suffix}@eventini.test`;

  interface Signed {
    readonly sessionId: string;
    readonly cookies: string;
  }

  function cookiesOf(response: request.Response): string[] {
    return (response.headers['set-cookie'] ?? []) as unknown as string[];
  }

  function cookieValue(
    response: request.Response,
    name: string,
  ): string | undefined {
    return cookiesOf(response)
      .map((cookie) => {
        const [pair] = cookie.split(';');

        return pair?.startsWith(`${name}=`)
          ? pair.slice(name.length + 1)
          : undefined;
      })
      .find((value): value is string => value !== undefined);
  }

  async function signIn(): Promise<Signed> {
    const response = await request(app.getHttpServer())
      .post(SESSIONS)
      .send({ email, password: PASSWORD, clientType: 'WEB' });

    expect(response.status).toBe(201);

    const access = cookieValue(response, names.access) as string;
    const refresh = cookieValue(response, names.refresh) as string;

    return {
      sessionId: (response.body as ApiEnvelope<{ sessionId: string }>).data
        ?.sessionId as string,
      cookies: `${names.access}=${access}; ${names.refresh}=${refresh}`,
    };
  }

  async function statusOf(sessionId: string): Promise<string | undefined> {
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
    names = { access: cookies.access.name, refresh: cookies.refresh.name };

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
       VALUES ($1, 'L', $2, 'ACTIVE', 'free', true, now())`,
      [org, `l-${suffix}`],
    );
    await pool.query(
      `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
       VALUES ($1, $2, $2, 'L', 'L', 'ACTIVE', now())`,
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

  describe('DELETE /auth/sessions/current', () => {
    it('revokes the session and clears both cookies', async () => {
      const session = await signIn();

      const response = await request(app.getHttpServer())
        .delete(`${SESSIONS}/current`)
        .set('Cookie', session.cookies);

      expect(response.status).toBe(204);
      expect(await statusOf(session.sessionId)).toBe('REVOKED');

      const cleared = cookiesOf(response);
      expect(cleared).toHaveLength(2);
      // C-19: the delete must replay HttpOnly, or some browsers keep the
      // cookie and the logout does not log anybody out.
      for (const cookie of cleared) {
        expect(cookie).toContain('HttpOnly');
      }
    });

    it('kills the refresh token with the session', async () => {
      const session = await signIn();
      await request(app.getHttpServer())
        .delete(`${SESSIONS}/current`)
        .set('Cookie', session.cookies);

      const rows = await pool.query<{ status: string }>(
        `SELECT status FROM refresh_token_rotations WHERE session_id = $1`,
        [session.sessionId],
      );

      expect(rows.rows.every((row) => row.status !== 'ACTIVE')).toBe(true);
    });

    /** §11 test 12: a still-valid access token on a revoked session. */
    it('refuses the access token that was valid a moment ago', async () => {
      const session = await signIn();
      await request(app.getHttpServer())
        .delete(`${SESSIONS}/current`)
        .set('Cookie', session.cookies);

      const after = await request(app.getHttpServer())
        .get(SESSIONS)
        .set('Cookie', session.cookies);

      expect(after.status).toBe(401);
    });

    it('refuses a request with no cookies at all', async () => {
      const response = await request(app.getHttpServer()).delete(
        `${SESSIONS}/current`,
      );

      expect(response.status).toBe(401);
    });
  });

  /**
   * 🔴 The version bump is what makes this immediate. Without it every access
   * token stays valid until its own expiry, and "log out everywhere" means
   * "in ten minutes, everywhere".
   */
  describe('DELETE /auth/sessions', () => {
    it('revokes every session and bumps users.version', async () => {
      const first = await signIn();
      const second = await signIn();

      const before = await pool.query<{ version: number }>(
        `SELECT version FROM users WHERE id = $1`,
        [user],
      );

      const response = await request(app.getHttpServer())
        .delete(SESSIONS)
        .set('Cookie', second.cookies);

      expect(response.status).toBe(204);
      expect(await statusOf(first.sessionId)).toBe('REVOKED');
      expect(await statusOf(second.sessionId)).toBe('REVOKED');

      const after = await pool.query<{ version: number }>(
        `SELECT version FROM users WHERE id = $1`,
        [user],
      );

      expect(after.rows[0]!.version).toBe(before.rows[0]!.version + 1);
    });

    it('invalidates a token issued to a session it never touched', async () => {
      const other = await signIn();
      const caller = await signIn();

      await request(app.getHttpServer())
        .delete(SESSIONS)
        .set('Cookie', caller.cookies);

      const response = await request(app.getHttpServer())
        .get(SESSIONS)
        .set('Cookie', other.cookies);

      expect(response.status).toBe(401);
    });

    it('leaves no usable refresh token behind', async () => {
      const session = await signIn();
      const refresh = session.cookies;

      await request(app.getHttpServer())
        .delete(SESSIONS)
        .set('Cookie', session.cookies);

      const rotation = await request(app.getHttpServer())
        .post(`${SESSIONS}/current/rotation`)
        .set('Cookie', refresh);

      expect(rotation.status).toBe(401);
    });
  });

  describe('DELETE /auth/sessions/{sessionId}', () => {
    it('revokes another session of the same user', async () => {
      const target = await signIn();
      const caller = await signIn();

      const response = await request(app.getHttpServer())
        .delete(`${SESSIONS}/${target.sessionId}`)
        .set('Cookie', caller.cookies);

      expect(response.status).toBe(204);
      expect(await statusOf(target.sessionId)).toBe('REVOKED');
      // The caller's own session survives a targeted revocation.
      expect(await statusOf(caller.sessionId)).toBe('ACTIVE');
    });

    /**
     * 🔴 Ownership. A valid session id belonging to somebody else answers
     * exactly like one that never existed — BOLA, and the reason step 7 of
     * the chain exists.
     */
    it('will not revoke a session belonging to someone else', async () => {
      const caller = await signIn();

      const stranger = `ses_${unique()}`;
      await pool.query(
        `INSERT INTO user_sessions
           (id, user_id, organization_id, active_membership_id, token_family_id,
            client_type, status, authentication_level,
            idle_expires_at, absolute_expires_at, updated_at)
         SELECT $1, u.id, NULL, NULL, $2, 'WEB', 'ACTIVE', 'PASSWORD',
                now() + interval '1 day', now() + interval '2 days', now()
           FROM users u WHERE u.normalized_email <> $3 LIMIT 1`,
        [stranger, `fam_${unique()}`, email],
      );

      const response = await request(app.getHttpServer())
        .delete(`${SESSIONS}/${stranger}`)
        .set('Cookie', caller.cookies);

      expect(response.status).toBe(404);
      expect(await statusOf(stranger)).toBe('ACTIVE');

      await pool.query(`DELETE FROM user_sessions WHERE id = $1`, [stranger]);
    });

    it('answers the same way for a session id that never existed', async () => {
      const caller = await signIn();

      const response = await request(app.getHttpServer())
        .delete(`${SESSIONS}/ses_nonexistent`)
        .set('Cookie', caller.cookies);

      expect(response.status).toBe(404);
    });
  });

  describe('GET /auth/sessions', () => {
    it('lists the active sessions and marks the current one', async () => {
      await signIn();
      const caller = await signIn();

      const response = await request(app.getHttpServer())
        .get(SESSIONS)
        .set('Cookie', caller.cookies);

      expect(response.status).toBe(200);

      const body = response.body as ApiEnvelope<
        { sessionId: string; current: boolean }[]
      >;
      const current = body.data?.filter((session) => session.current) ?? [];

      expect(current).toHaveLength(1);
      expect(current[0]?.sessionId).toBe(caller.sessionId);
    });

    it('never exposes a token', async () => {
      const caller = await signIn();

      const response = await request(app.getHttpServer())
        .get(SESSIONS)
        .set('Cookie', caller.cookies);

      const serialized = JSON.stringify(response.body);

      expect(serialized).not.toContain('eyJ');
      expect(serialized).not.toContain('token');
    });

    it('refuses an unsigned request', async () => {
      const response = await request(app.getHttpServer()).get(SESSIONS);

      expect(response.status).toBe(401);
    });
  });
});
