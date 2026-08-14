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
import { PermissionsVersionStore } from '../../src/modules/identity/authorization/domain/permissions-version.store';
import { PasswordHasher } from '../../src/modules/identity/passwords/domain/password-hasher';
import { csrfOf, preSessionCsrf, resetRateLimits, type Csrf } from '../helpers';

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
  /** EVT-039 — consultatifs, jamais faisant autorité. */
  role: string | null;
  permissions: string[];
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

  /**
   * Returns the session cookies and the CSRF pair the login rebound to them.
   * The pre-session pair used to get in is spent by that point: presenting it
   * again alongside a session cookie is exactly what ADR-0016 refuses.
   */
  async function signIn(): Promise<{ jar: string; csrf: Csrf }> {
    const response = await request(server())
      .post('/api/v1/auth/sessions')
      .set((await preSessionCsrf(app)).headers())
      .send({ email, password: PASSWORD, clientType: 'WEB' })
      .expect(201);

    const access = cookieValue(response, names.access);
    const refresh = cookieValue(response, names.refresh);

    return {
      jar: `${names.access}=${access}; ${names.refresh}=${refresh}`,
      csrf: csrfOf(app, response),
    };
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
    const { jar, csrf } = await signIn();

    await request(server())
      .delete('/api/v1/auth/sessions/current')
      .set(csrf.headers(jar))
      .expect(204);

    const response = await request(server())
      .get('/api/v1/auth/me')
      .set('Cookie', jar);

    expect(response.status).toBe(401);
  });

  describe('for a signed-in caller', () => {
    it('reports the profile, the active session and the client type', async () => {
      const { jar } = await signIn();

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

    /**
     * EVT-039 — le contexte d'autorisation consultatif.
     *
     * Sans rôle assigné, `role` vaut `null` et `permissions` est vide. C'est le
     * cas d'un membre invité mais pas encore habilité, et l'interface doit
     * lire ce `null` comme « aucune autorité particulière », jamais comme
     * « pas encore chargé ».
     */
    it("renvoie un contexte d'autorisation vide quand aucun rôle n'est assigné", async () => {
      const { jar } = await signIn();

      const response = await request(server())
        .get('/api/v1/auth/me')
        .set('Cookie', jar)
        .expect(200);

      const body = (response.body as ApiEnvelope<CurrentUserResponse>).data!;

      expect(body.role).toBeNull();
      expect(body.permissions).toEqual([]);
    });

    it("renvoie le rôle et les permissions effectives de l'organisation active", async () => {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM roles WHERE code = 'CLIENT_ADMIN'`,
      );
      const assignment = `mra_${suffix}`;

      await pool.query(
        `INSERT INTO membership_role_assignments
           (id, membership_id, organization_id, role_id)
         VALUES ($1, $2, $3, $4)`,
        [assignment, `mbr_${suffix}`, ids.org, rows[0]!.id],
      );
      await app
        .get(PermissionsVersionStore, { strict: false })
        .bumpMembership(`mbr_${suffix}`);

      try {
        const { jar } = await signIn();

        const response = await request(server())
          .get('/api/v1/auth/me')
          .set('Cookie', jar)
          .expect(200);

        const body = (response.body as ApiEnvelope<CurrentUserResponse>).data!;

        expect(body.role).toBe('CLIENT_ADMIN');
        // Le catalogue seedé accorde forcément quelque chose à un
        // administrateur client ; l'assertion porte sur le fait que la
        // résolution a bien eu lieu, pas sur un code particulier qui
        // évoluerait avec le catalogue.
        expect(body.permissions.length).toBeGreaterThan(0);
      } finally {
        await pool.query(
          `DELETE FROM membership_role_assignments WHERE id = $1`,
          [assignment],
        );
      }
    });

    /**
     * 🔴 La garantie centrale d'ADR-0004 : les permissions ne voyagent pas
     * dans le jeton. Elles sont résolues à chaque requête, donc une révocation
     * prend effet immédiatement — et non à l'expiration du jeton.
     */
    it("cesse d'annoncer un rôle révoqué sur le MÊME jeton d'accès", async () => {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM roles WHERE code = 'CLIENT_ADMIN'`,
      );
      const assignment = `mrb_${suffix}`;

      await pool.query(
        `INSERT INTO membership_role_assignments
           (id, membership_id, organization_id, role_id)
         VALUES ($1, $2, $3, $4)`,
        [assignment, `mbr_${suffix}`, ids.org, rows[0]!.id],
      );
      await app
        .get(PermissionsVersionStore, { strict: false })
        .bumpMembership(`mbr_${suffix}`);

      const { jar } = await signIn();

      await request(server())
        .get('/api/v1/auth/me')
        .set('Cookie', jar)
        .expect(200);

      await pool.query(
        `UPDATE membership_role_assignments SET revoked_at = now() WHERE id = $1`,
        [assignment],
      );
      await app
        .get(PermissionsVersionStore, { strict: false })
        .bumpMembership(`mbr_${suffix}`);

      try {
        const after = await request(server())
          .get('/api/v1/auth/me')
          .set('Cookie', jar)
          .expect(200);

        const body = (after.body as ApiEnvelope<CurrentUserResponse>).data!;

        expect(body.role).toBeNull();
        expect(body.permissions).toEqual([]);
      } finally {
        await pool.query(
          `DELETE FROM membership_role_assignments WHERE id = $1`,
          [assignment],
        );
      }
    });

    it('never exposes a password hash or any credential material', async () => {
      const { jar } = await signIn();

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
      const { jar } = await signIn();

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
        .set((await preSessionCsrf(app)).headers())
        .send({ email, password: PASSWORD, clientType: 'WEB' })
        .expect(401);

      expect((response.body as ApiEnvelope<null>).error?.code).toBe(
        'AUTH_MFA_REQUIRED',
      );
    });
  });
});
