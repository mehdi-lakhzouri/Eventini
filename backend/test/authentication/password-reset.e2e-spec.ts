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
import { authenticationConfig } from '../../src/config/authentication.config';
import { cookiesConfig } from '../../src/config/cookies.config';
import { PasswordHasher } from '../../src/modules/identity/passwords/domain/password-hasher';
import { RequestPasswordResetUseCase } from '../../src/modules/identity/passwords/application/request-password-reset.use-case';
import { csrfOf, preSessionCsrf } from '../helpers';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a completely different passphrase';

describeWithDatabase('password reset and change', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let names: { access: string; refresh: string };
  let issue: RequestPasswordResetUseCase;

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);
  const suffix = unique();
  const org = `org_${suffix}`;
  const user = `usr_${suffix}`;
  const email = `reset.${suffix}@eventini.test`;

  function cookiesOf(response: request.Response): string[] {
    return (response.headers['set-cookie'] ?? []) as unknown as string[];
  }

  function cookieValue(response: request.Response, name: string): string {
    return cookiesOf(response)
      .map((cookie) => {
        const [pair] = cookie.split(';');

        return pair?.startsWith(`${name}=`)
          ? pair.slice(name.length + 1)
          : undefined;
      })
      .find((value): value is string => value !== undefined) as string;
  }

  /**
   * Login is a `POST`, so since EVT-028 it goes through `CsrfGuard` like any
   * other mutation: the pre-session handshake first, then the credentials.
   * The returned pair is read back off the login response, which rebinds it to
   * the new session — using the pre-session pair afterwards would 403.
   */
  async function signIn(password = PASSWORD) {
    const handshake = await preSessionCsrf(app);
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/sessions')
      .set(handshake.headers())
      .send({ email, password, clientType: 'WEB' });

    return {
      status: response.status,
      sessionId: (response.body as ApiEnvelope<{ sessionId: string }>).data
        ?.sessionId as string,
      cookies: `${names.access}=${cookieValue(response, names.access)}; ${names.refresh}=${cookieValue(response, names.refresh)}`,
      csrf: csrfOf(app, response),
    };
  }

  /** The token never leaves the server, so the test asks the use case for it. */
  async function freshResetToken(): Promise<string> {
    const issued = await issue.execute({ email, requestedIp: null });

    return (issued as { token: string }).token;
  }

  async function resetPassword(password: string) {
    await pool.query(
      `UPDATE user_credentials SET password_hash = $1 WHERE user_id = $2`,
      [password, user],
    );
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

    issue = app.get(RequestPasswordResetUseCase, { strict: false });
    const hash = await app
      .get(PasswordHasher, { strict: false })
      .hash(PASSWORD);

    pool = new Pool({ connectionString: DATABASE_URL, max: 5 });
    pool.on('error', () => undefined);

    await pool.query(
      `INSERT INTO organizations (id, name, slug, status, license_plan, is_enabled, updated_at)
       VALUES ($1, 'P', $2, 'ACTIVE', 'free', true, now())`,
      [org, `p-${suffix}`],
    );
    await pool.query(
      `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
       VALUES ($1, $2, $2, 'P', 'P', 'ACTIVE', now())`,
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

  afterEach(async () => {
    // Each test starts from the known password, whatever it changed it to.
    const hash = await app
      .get(PasswordHasher, { strict: false })
      .hash(PASSWORD);
    await resetPassword(hash);
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

    await pool.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [
      user,
    ]);
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

  /**
   * 🔴 This endpoint is unauthenticated. Answering differently for a known and
   * an unknown address would turn it into a register of which email addresses
   * have accounts.
   */
  describe('POST /auth/password-reset-requests', () => {
    it.each([
      ['a known address', () => email],
      ['an unknown address', () => `nobody.${unique()}@eventini.test`],
    ])('answers 202 with the same body for %s', async (_label, address) => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/password-reset-requests')
        .set((await preSessionCsrf(app)).headers())
        .send({ email: address() });

      expect(response.status).toBe(202);
      expect(
        (response.body as ApiEnvelope<{ accepted: boolean }>).data,
      ).toEqual({ accepted: true });
    });

    it('never returns the token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/password-reset-requests')
        .set((await preSessionCsrf(app)).headers())
        .send({ email });

      const stored = await pool.query<{ token_hash: string }>(
        `SELECT token_hash FROM password_reset_tokens WHERE user_id = $1
          ORDER BY created_at DESC LIMIT 1`,
        [user],
      );

      expect(JSON.stringify(response.body)).not.toContain(
        stored.rows[0]?.token_hash ?? 'never',
      );
      expect(Object.keys(response.body as object)).toEqual([
        'data',
        'meta',
        'error',
      ]);
    });

    it('stores the token hashed, never in the clear', async () => {
      const token = await freshResetToken();

      const stored = await pool.query<{ token_hash: string }>(
        `SELECT token_hash FROM password_reset_tokens WHERE user_id = $1
          ORDER BY created_at DESC LIMIT 1`,
        [user],
      );

      expect(stored.rows[0]?.token_hash).not.toBe(token);
      expect(stored.rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    /** A second request must not leave the first link working. */
    it('replaces any pending token of the same user', async () => {
      const first = await freshResetToken();
      await freshResetToken();

      const statuses = await pool.query<{ status: string }>(
        `SELECT status FROM password_reset_tokens WHERE user_id = $1
          ORDER BY created_at`,
        [user],
      );

      expect(statuses.rows.at(-1)?.status).toBe('PENDING');
      expect(
        statuses.rows.slice(0, -1).every((row) => row.status !== 'PENDING'),
      ).toBe(true);

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/password-resets')
        .set((await preSessionCsrf(app)).headers())
        .send({ token: first, newPassword: NEW_PASSWORD });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /auth/password-resets', () => {
    it('sets the new password and consumes the token', async () => {
      const token = await freshResetToken();

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/password-resets')
        .set((await preSessionCsrf(app)).headers())
        .send({ token, newPassword: NEW_PASSWORD });

      expect(response.status).toBe(204);
      expect((await signIn(NEW_PASSWORD)).status).toBe(201);
    });

    it('refuses the same token twice', async () => {
      const token = await freshResetToken();
      await request(app.getHttpServer())
        .post('/api/v1/auth/password-resets')
        .set((await preSessionCsrf(app)).headers())
        .send({ token, newPassword: NEW_PASSWORD });

      const second = await request(app.getHttpServer())
        .post('/api/v1/auth/password-resets')
        .set((await preSessionCsrf(app)).headers())
        .send({ token, newPassword: 'yet another passphrase here' });

      expect(second.status).toBe(401);
    });

    /** 🔴 Whoever forced the reset may be holding a session of their own. */
    it('revokes every session and bumps users.version', async () => {
      const session = await signIn();
      const before = await pool.query<{ version: number }>(
        `SELECT version FROM users WHERE id = $1`,
        [user],
      );

      const token = await freshResetToken();
      await request(app.getHttpServer())
        .post('/api/v1/auth/password-resets')
        .set((await preSessionCsrf(app)).headers())
        .send({ token, newPassword: NEW_PASSWORD });

      const status = await pool.query<{ status: string }>(
        `SELECT status FROM user_sessions WHERE id = $1`,
        [session.sessionId],
      );
      const after = await pool.query<{ version: number }>(
        `SELECT version FROM users WHERE id = $1`,
        [user],
      );

      expect(status.rows[0]?.status).toBe('REVOKED');
      expect(after.rows[0]!.version).toBeGreaterThan(before.rows[0]!.version);

      const stale = await request(app.getHttpServer())
        .get('/api/v1/auth/sessions')
        .set('Cookie', session.cookies);

      expect(stale.status).toBe(401);
    });

    it('refuses an expired token', async () => {
      const token = await freshResetToken();
      await pool.query(
        `UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute'
          WHERE user_id = $1 AND status = 'PENDING'`,
        [user],
      );

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/password-resets')
        .set((await preSessionCsrf(app)).headers())
        .send({ token, newPassword: NEW_PASSWORD });

      expect(response.status).toBe(401);
    });

    it('refuses a token nobody issued', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/password-resets')
        .set((await preSessionCsrf(app)).headers())
        .send({ token: 'not-a-token', newPassword: NEW_PASSWORD });

      expect(response.status).toBe(401);
    });

    /** A rejected password must not burn the link. */
    it('leaves the token usable when the new password is refused', async () => {
      const token = await freshResetToken();

      const rejected = await request(app.getHttpServer())
        .post('/api/v1/auth/password-resets')
        .set((await preSessionCsrf(app)).headers())
        .send({ token, newPassword: 'short' });

      expect(rejected.status).toBe(400);

      const accepted = await request(app.getHttpServer())
        .post('/api/v1/auth/password-resets')
        .set((await preSessionCsrf(app)).headers())
        .send({ token, newPassword: NEW_PASSWORD });

      expect(accepted.status).toBe(204);
    });
  });

  describe('PUT /auth/password', () => {
    it('changes the password and keeps the current session alive', async () => {
      const session = await signIn();

      const response = await request(app.getHttpServer())
        .put('/api/v1/auth/password')
        .set(session.csrf.headers(session.cookies))
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });

      expect(response.status).toBe(204);

      const still = await request(app.getHttpServer())
        .get('/api/v1/auth/sessions')
        .set('Cookie', session.cookies);

      expect(still.status).toBe(200);
    });

    it('revokes the other sessions', async () => {
      const other = await signIn();
      const current = await signIn();

      await request(app.getHttpServer())
        .put('/api/v1/auth/password')
        .set(current.csrf.headers(current.cookies))
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });

      const statuses = await pool.query<{ id: string; status: string }>(
        `SELECT id, status FROM user_sessions WHERE id = ANY($1)`,
        [[other.sessionId, current.sessionId]],
      );
      const byId = new Map(statuses.rows.map((row) => [row.id, row.status]));

      expect(byId.get(other.sessionId)).toBe('REVOKED');
      expect(byId.get(current.sessionId)).toBe('ACTIVE');
    });

    it('refuses a wrong current password', async () => {
      const session = await signIn();

      const response = await request(app.getHttpServer())
        .put('/api/v1/auth/password')
        .set(session.csrf.headers(session.cookies))
        .send({ currentPassword: 'wrong', newPassword: NEW_PASSWORD });

      expect(response.status).toBe(401);
      expect((await signIn()).status).toBe(201);
    });

    /**
     * A valid pre-session CSRF pair is supplied deliberately. `CsrfGuard` runs
     * *before* authentication (§5.1's ordering), so a request carrying neither
     * would be refused at 403 for the missing token and prove nothing about
     * authentication. Clearing CSRF first isolates the 401.
     */
    it('refuses an unauthenticated request', async () => {
      const response = await request(app.getHttpServer())
        .put('/api/v1/auth/password')
        .set((await preSessionCsrf(app)).headers())
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });

      expect(response.status).toBe(401);
    });

    it('refuses a mutation with no CSRF token before it looks at the session', async () => {
      const { Origin } = (await preSessionCsrf(app)).headers();

      const response = await request(app.getHttpServer())
        .put('/api/v1/auth/password')
        .set('Origin', Origin as string)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });

      expect(response.status).toBe(403);
    });

    it('applies the password policy', async () => {
      const session = await signIn();

      const response = await request(app.getHttpServer())
        .put('/api/v1/auth/password')
        .set(session.csrf.headers(session.cookies))
        .send({ currentPassword: PASSWORD, newPassword: 'tooshort' });

      expect(response.status).toBe(400);
    });
  });

  it('keeps the reset secret out of the token it stores', () => {
    const auth = app.get<ConfigType<typeof authenticationConfig>>(
      authenticationConfig.KEY,
    );

    expect(auth.tokens.passwordResetSecret).not.toBe(
      auth.refreshToken.hmacSecret,
    );
  });
});
