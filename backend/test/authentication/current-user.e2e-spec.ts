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

interface CurrentUserResponse {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  status: string;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  mfaEnabled: boolean;
  sessionId: string;
  organizationId: string | null;
  membershipId: string | null;
  clientType: string;
  authenticationLevel: string;
}

describeWithDatabase('GET /api/v1/auth/me', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let names: { access: string; refresh: string };

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);
  const suffix = unique();
  const ids = { org: `org_m${suffix}`, user: `usr_m${suffix}` };
  const email = `me.${suffix}@eventini.test`;

  const server = () => app.getHttpServer();

  function cookieValue(response: request.Response, name: string): string {
    const cookies = (response.headers['set-cookie'] ??
      []) as unknown as string[];

    return cookies
      .map((cookie) => {
        const [pair] = cookie.split(';');

        return pair?.startsWith(`${name}=`)
          ? pair.slice(name.length + 1)
          : undefined;
      })
      .find((value): value is string => value !== undefined) as string;
  }

  async function signIn(): Promise<string> {
    const response = await request(server())
      .post('/api/v1/auth/sessions')
      .send({ email, password: PASSWORD, clientType: 'WEB' })
      .expect(201);

    const access = cookieValue(response, names.access);
    const refresh = cookieValue(response, names.refresh);

    return `${names.access}=${access}; ${names.refresh}=${refresh}`;
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

    pool = new Pool({ connectionString: DATABASE_URL, max: 3 });
    pool.on('error', () => undefined);

    await pool.query(
      `INSERT INTO organizations (id, name, slug, status, license_plan, is_enabled, updated_at)
       VALUES ($1, 'Me', $2, 'ACTIVE', 'free', true, now())`,
      [ids.org, `me-${suffix}`],
    );
    await pool.query(
      `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, display_name, status, email_verified_at, updated_at)
       VALUES ($1, $2, $2, 'Ada', 'Lovelace', 'Ada L.', 'ACTIVE', now(), now())`,
      [ids.user, email],
    );
    await pool.query(
      `INSERT INTO user_credentials (id, user_id, password_hash, updated_at)
       VALUES ($1, $2, $3, now())`,
      [`cred_${suffix}`, ids.user, hash],
    );
    await pool.query(
      `INSERT INTO organization_memberships (id, user_id, organization_id, status, updated_at)
       VALUES ($1, $2, $3, 'ACTIVE', now())`,
      [`mbr_${suffix}`, ids.user, ids.org],
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
        [ids.user],
      );
      await purge.query('COMMIT');
    } finally {
      purge.release();
    }

    await pool.query(`DELETE FROM mfa_methods WHERE user_id = $1`, [ids.user]);
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

  it('refuses an unauthenticated request', async () => {
    const response = await request(server()).get('/api/v1/auth/me');

    expect(response.status).toBe(401);
    expect((response.body as ApiEnvelope<null>).error?.code).toBe(
      'AUTHENTICATION_REQUIRED',
    );
  });

  it('refuses a cookie for a session that was revoked', async () => {
    const jar = await signIn();

    await request(server())
      .delete('/api/v1/auth/sessions/current')
      .set('Cookie', jar)
      .expect(204);

    const response = await request(server())
      .get('/api/v1/auth/me')
      .set('Cookie', jar);

    expect(response.status).toBe(401);
  });

  describe('for a signed-in caller', () => {
    it('reports the profile, the active session and the client type', async () => {
      const jar = await signIn();

      const response = await request(server())
        .get('/api/v1/auth/me')
        .set('Cookie', jar)
        .expect(200);

      const body = (response.body as ApiEnvelope<CurrentUserResponse>).data!;

      expect(body.userId).toBe(ids.user);
      expect(body.email).toBe(email.toLowerCase());
      expect(body.firstName).toBe('Ada');
      expect(body.lastName).toBe('Lovelace');
      expect(body.displayName).toBe('Ada L.');
      expect(body.status).toBe('ACTIVE');
      expect(body.emailVerifiedAt).not.toBeNull();
      expect(body.organizationId).toBe(ids.org);
      expect(body.membershipId).not.toBeNull();
      expect(body.clientType).toBe('WEB');
      expect(body.authenticationLevel).toBe('PASSWORD');
      expect(body.mfaEnabled).toBe(false);
    });

    it('never exposes a password hash or any credential material', async () => {
      const jar = await signIn();

      const response = await request(server())
        .get('/api/v1/auth/me')
        .set('Cookie', jar)
        .expect(200);

      const raw = JSON.stringify(response.body);

      expect(raw).not.toMatch(/passwordHash|credential|argon2/i);
    });

    /**
     * The session is taken *before* the method is enrolled, and that ordering
     * is the real flow rather than a convenience: enrolment requires a signed-
     * in caller, so a user always has a session that predates their first MFA
     * method. Enrolling first and signing in afterwards would now stop at
     * EVT-027's login gate with `AUTH_MFA_REQUIRED` — correctly, which is why
     * this test reads `mfaEnabled` from the session the user already held.
     */
    it('reflects an active MFA method once one exists', async () => {
      const jar = await signIn();

      await pool.query(
        `INSERT INTO mfa_methods (id, user_id, type, status, encrypted_secret, enabled_at, updated_at)
         VALUES ($1, $2, 'TOTP', 'ACTIVE', 'ciphertext', now(), now())`,
        [`mfa_${unique()}`, ids.user],
      );

      const response = await request(server())
        .get('/api/v1/auth/me')
        .set('Cookie', jar)
        .expect(200);

      expect(
        (response.body as ApiEnvelope<CurrentUserResponse>).data!.mfaEnabled,
      ).toBe(true);
    });

    /**
     * The other half of the same interaction, asserted here so the two
     * features stay wired together: once a method is active, a fresh password
     * login no longer reaches a session at all.
     */
    it('is unreachable by password alone once MFA is active', async () => {
      const response = await request(server())
        .post('/api/v1/auth/sessions')
        .send({ email, password: PASSWORD, clientType: 'WEB' })
        .expect(401);

      expect((response.body as ApiEnvelope<null>).error?.code).toBe(
        'AUTH_MFA_REQUIRED',
      );
    });
  });
});
