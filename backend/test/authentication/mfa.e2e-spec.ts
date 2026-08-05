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
import { currentTotpCode } from '../../src/modules/identity/mfa/domain/totp';
import { MfaSecretCipher } from '../../src/modules/identity/mfa/infrastructure/mfa-secret.cipher';
import { PasswordHasher } from '../../src/modules/identity/passwords/domain/password-hasher';
import { csrfOf, preSessionCsrf, type Csrf } from '../helpers';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

const PASSWORD = 'correct horse battery staple';

describeWithDatabase('multi-factor authentication', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let cookieNames: { access: string; refresh: string };
  let totpSettings: {
    digits: number;
    periodSeconds: number;
    driftWindows: number;
  };

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);
  const suffix = unique();

  const ids = {
    org: `org_m${suffix}`,
    plain: `usr_plain${suffix}`,
    enrolled: `usr_enr${suffix}`,
  };

  const emailOf = (key: string): string => `${key}.${suffix}@eventini.test`;

  /**
   * Users accumulate because enrolling is one-way: once a user has an active
   * method every later login is gated, so a test that needs to enrol needs an
   * account nobody has enrolled yet. Cheaper and clearer than unwinding state.
   */
  const extraUsers: string[] = [];
  let passwordHash: string;

  async function freshUser(): Promise<string> {
    const id = `usr_x${unique()}`;
    const email = `x${id.slice(-8)}.${suffix}@eventini.test`;

    await createUser(id, email, passwordHash);
    extraUsers.push(id);

    return email;
  }

  async function createUser(id: string, email: string, hash: string) {
    await pool.query(
      `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
       VALUES ($1, $2, $2, 'A', 'B', 'ACTIVE', now())`,
      [id, email.toLowerCase()],
    );
    await pool.query(
      `INSERT INTO user_credentials (id, user_id, password_hash, updated_at)
       VALUES ($1, $2, $3, now())`,
      [`cred_${unique()}`, id, hash],
    );
    await pool.query(
      `INSERT INTO organization_memberships (id, user_id, organization_id, status, updated_at)
       VALUES ($1, $2, $3, 'ACTIVE', now())`,
      [`mbr_${unique()}`, id, ids.org],
    );
  }

  const server = () => app.getHttpServer();

  /**
   * One anonymous CSRF pair, reused by every unauthenticated call in this
   * suite. The context is stateless, so it stays valid as long as it is not
   * presented alongside a session cookie — which is the one thing ADR-0016
   * refuses, and which `csrf.e2e-spec.ts` covers directly.
   */
  let anon: Csrf;

  const login = (email: string) =>
    request(server())
      .post('/api/v1/auth/sessions')
      .set(anon.headers())
      .send({ email, password: PASSWORD, clientType: 'WEB' });

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

  /** Password login, then the enrolment routes, ending with an active method. */
  async function enrol(
    email: string,
  ): Promise<{ secret: string; recoveryCodes: string[] }> {
    const session = await login(email).expect(201);
    const access = cookieValue(session, cookieNames.access);
    // Enrolment is a mutation on an established session, so it carries the
    // pair the login rebound — the anonymous one would now be refused.
    const bound = csrfOf(app, session);
    const jar = `${cookieNames.access}=${access}`;

    const begun = await request(server())
      .post('/api/v1/auth/mfa/enrollments')
      .set(bound.headers(jar))
      .expect(201);

    const { enrollmentId, secret } = (
      begun.body as ApiEnvelope<{ enrollmentId: string; secret: string }>
    ).data!;

    const confirmed = await request(server())
      .post(`/api/v1/auth/mfa/enrollments/${enrollmentId}/confirmation`)
      .set(bound.headers(jar))
      .send({ code: await currentTotpCode(secret, totpSettings) })
      .expect(201);

    const { recoveryCodes } = (
      confirmed.body as ApiEnvelope<{ recoveryCodes: string[] }>
    ).data!;

    return { secret, recoveryCodes };
  }

  /** A login expected to stop at the gate; returns the challenge id. */
  async function challengeFor(email: string): Promise<string> {
    const gated = await login(email).expect(401);
    const error = (gated.body as ApiEnvelope<null>).error as unknown as {
      extensions: { challengeId: string };
    };

    return error.extensions.challengeId;
  }

  /**
   * The anonymous pair, deliberately: a gated login does not rebind CSRF,
   * because there is no session yet and the caller still has a second leg to
   * post. Verification carries no session cookie, so pre-session is the
   * correct mode here.
   */
  const verify = (challengeId: string, code: string) =>
    request(server())
      .post(`/api/v1/auth/mfa/challenges/${challengeId}/verification`)
      .set(anon.headers())
      .send({ code });

  async function countSessions(userId: string): Promise<number> {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM user_sessions WHERE user_id = $1`,
      [userId],
    );

    return Number(rows[0]?.count ?? '0');
  }

  /**
   * Reads the stored secret back through the application's own cipher, so a
   * test proves the value round-tripped through the database rather than
   * re-using something it kept in memory.
   */
  async function activeSecretOf(email: string): Promise<string> {
    const { rows } = await pool.query<{ encrypted_secret: string }>(
      `SELECT m.encrypted_secret FROM mfa_methods m
         JOIN users u ON u.id = m.user_id
        WHERE u.normalized_email = $1 AND m.status = 'ACTIVE'`,
      [email.toLowerCase()],
    );

    return app
      .get(MfaSecretCipher, { strict: false })
      .decrypt(rows[0]!.encrypted_secret);
  }

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: false,
    });

    const cookies = app.get<ConfigType<typeof cookiesConfig>>(
      cookiesConfig.KEY,
    );
    cookieNames = {
      access: cookies.access.name,
      refresh: cookies.refresh.name,
    };

    // Without this no route can read the access cookie, and every
    // authenticated request 401s for a reason that has nothing to do with MFA.
    app.use(cookieParser(cookies.secret));
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();

    anon = await preSessionCsrf(app);

    const auth = app.get<ConfigType<typeof authenticationConfig>>(
      authenticationConfig.KEY,
    );
    totpSettings = {
      digits: auth.mfa.totpDigits,
      periodSeconds: auth.mfa.totpPeriodSeconds,
      driftWindows: auth.mfa.totpDriftWindows,
    };

    passwordHash = await app
      .get(PasswordHasher, { strict: false })
      .hash(PASSWORD);

    pool = new Pool({ connectionString: DATABASE_URL, max: 3 });
    pool.on('error', () => undefined);

    await pool.query(
      `INSERT INTO organizations (id, name, slug, status, license_plan, is_enabled, updated_at)
       VALUES ($1, 'M', $2, 'ACTIVE', 'free', true, now())`,
      [ids.org, `m-${suffix}`],
    );

    await createUser(ids.plain, emailOf('plain'), passwordHash);
    await createUser(ids.enrolled, emailOf('enrolled'), passwordHash);
  });

  afterAll(async () => {
    const users = [ids.plain, ids.enrolled, ...extraUsers];

    const purge = await pool.connect();
    try {
      await purge.query('BEGIN');
      await purge.query("SET LOCAL eventini.retention_purge = 'on'");
      await purge.query(
        `DELETE FROM refresh_token_rotations
          WHERE session_id IN (SELECT id FROM user_sessions WHERE user_id = ANY($1))`,
        [users],
      );
      await purge.query('COMMIT');
    } finally {
      purge.release();
    }

    await pool.query(
      `DELETE FROM mfa_recovery_codes
        WHERE mfa_method_id IN (SELECT id FROM mfa_methods WHERE user_id = ANY($1))`,
      [users],
    );
    await pool.query(`DELETE FROM mfa_methods WHERE user_id = ANY($1)`, [
      users,
    ]);
    await pool.query(`DELETE FROM user_sessions WHERE user_id = ANY($1)`, [
      users,
    ]);
    await pool.query(
      `DELETE FROM organization_memberships WHERE user_id = ANY($1)`,
      [users],
    );
    await pool.query(`DELETE FROM user_credentials WHERE user_id = ANY($1)`, [
      users,
    ]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [users]);
    await pool.query(`DELETE FROM organizations WHERE id = $1`, [ids.org]);

    await pool.end();
    await app.close();
  });

  describe('enrolment', () => {
    it('activates a method only once a real code proves the secret', async () => {
      const { secret, recoveryCodes } = await enrol(emailOf('enrolled'));

      expect(secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(recoveryCodes).toHaveLength(10);

      const { rows } = await pool.query(
        `SELECT status FROM mfa_methods WHERE user_id = $1 AND status = 'ACTIVE'`,
        [ids.enrolled],
      );
      expect(rows).toHaveLength(1);
    });

    it('stores the secret encrypted, never in the clear', async () => {
      const { rows } = await pool.query<{ encrypted_secret: string }>(
        `SELECT encrypted_secret FROM mfa_methods
          WHERE user_id = $1 AND status = 'ACTIVE'`,
        [ids.enrolled],
      );

      // Base32 is the shape a TOTP secret has; this must not be that.
      expect(rows[0]?.encrypted_secret).not.toMatch(/^[A-Z2-7]{32}$/);
      expect(rows[0]?.encrypted_secret).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('stores recovery codes hashed, never in the clear', async () => {
      const { rows } = await pool.query<{ code_hash: string }>(
        `SELECT rc.code_hash FROM mfa_recovery_codes rc
           JOIN mfa_methods m ON m.id = rc.mfa_method_id
          WHERE m.user_id = $1`,
        [ids.enrolled],
      );

      expect(rows).toHaveLength(10);
      for (const row of rows) {
        expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    // A valid CSRF pair, so the 401 is about the missing session rather than
    // the guard that runs ahead of authentication.
    it('refuses to enrol without a session', async () => {
      await request(server())
        .post('/api/v1/auth/mfa/enrollments')
        .set(anon.headers())
        .expect(401);
    });
  });

  /**
   * 🔴 The acceptance criterion of EVT-027.
   *
   * The password is correct in every one of these. What they assert is that
   * being right about it produces nothing usable until a code is verified.
   */
  describe('the login gate', () => {
    it('answers AUTH_MFA_REQUIRED and sets no cookie at all', async () => {
      const response = await login(emailOf('enrolled')).expect(401);
      const envelope = response.body as ApiEnvelope<null>;

      expect(envelope.error?.code).toBe('AUTH_MFA_REQUIRED');
      expect(envelope.data).toBeNull();
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('creates no session row for a login stopped at the gate', async () => {
      const before = await countSessions(ids.enrolled);
      await login(emailOf('enrolled')).expect(401);

      expect(await countSessions(ids.enrolled)).toBe(before);
    });

    it('carries the challenge id and nothing else', async () => {
      const response = await login(emailOf('enrolled')).expect(401);
      const error = (response.body as ApiEnvelope<null>).error as unknown as {
        extensions: Record<string, string>;
      };

      expect(Object.keys(error.extensions)).toEqual(['challengeId']);
      // A JWT would start with this; nothing token-shaped may be in the body.
      expect(JSON.stringify(response.body)).not.toContain('eyJ');
    });

    it('lets a user without MFA straight through', async () => {
      const response = await login(emailOf('plain')).expect(201);

      expect(cookieValue(response, cookieNames.access)).toBeDefined();
      expect(cookieValue(response, cookieNames.refresh)).toBeDefined();
    });
  });

  describe('challenge verification', () => {
    it('issues the session once the code is right, at level MFA', async () => {
      const challengeId = await challengeFor(emailOf('enrolled'));
      const secret = await activeSecretOf(emailOf('enrolled'));

      const response = await verify(
        challengeId,
        await currentTotpCode(secret, totpSettings),
      ).expect(201);

      expect(cookieValue(response, cookieNames.access)).toBeDefined();
      expect(cookieValue(response, cookieNames.refresh)).toBeDefined();

      const { sessionId } = (
        response.body as ApiEnvelope<{ sessionId: string }>
      ).data!;
      const { rows } = await pool.query<{ authentication_level: string }>(
        `SELECT authentication_level FROM user_sessions WHERE id = $1`,
        [sessionId],
      );

      expect(rows[0]?.authentication_level).toBe('MFA');
    });

    it('refuses a wrong code without issuing anything', async () => {
      const challengeId = await challengeFor(emailOf('enrolled'));

      const response = await verify(challengeId, '000000').expect(401);

      expect((response.body as ApiEnvelope<null>).error?.code).toBe(
        'AUTH_MFA_INVALID',
      );
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('refuses an unknown challenge the same way as a wrong code', async () => {
      const response = await verify('ses_nope', '000000').expect(401);

      expect((response.body as ApiEnvelope<null>).error?.code).toBe(
        'AUTH_MFA_INVALID',
      );
    });

    it('spends the challenge, so a replay cannot mint a second session', async () => {
      const challengeId = await challengeFor(emailOf('enrolled'));
      const secret = await activeSecretOf(emailOf('enrolled'));
      const code = await currentTotpCode(secret, totpSettings);

      await verify(challengeId, code).expect(201);
      // Same challenge, same still-valid code: the challenge itself is gone.
      await verify(challengeId, code).expect(401);
    });
  });

  describe('recovery codes', () => {
    it('accepts a recovery code and reports that one was spent', async () => {
      const email = await freshUser();
      const { recoveryCodes } = await enrol(email);
      const challengeId = await challengeFor(email);

      const response = await verify(challengeId, recoveryCodes[0]!).expect(201);

      expect(
        (response.body as ApiEnvelope<{ usedRecoveryCode: boolean }>).data!
          .usedRecoveryCode,
      ).toBe(true);
    });

    it('refuses the same recovery code a second time', async () => {
      const email = await freshUser();
      const { recoveryCodes } = await enrol(email);
      const first = await challengeFor(email);

      await verify(first, recoveryCodes[1]!).expect(201);

      const second = await challengeFor(email);
      await verify(second, recoveryCodes[1]!).expect(401);
    });

    it('revokes the whole old batch when codes are regenerated', async () => {
      const email = await freshUser();
      const { recoveryCodes } = await enrol(email);
      const challengeId = await challengeFor(email);
      const secret = await activeSecretOf(email);

      const session = await verify(
        challengeId,
        await currentTotpCode(secret, totpSettings),
      ).expect(201);
      const access = cookieValue(session, cookieNames.access);

      const regenerated = await request(server())
        .post('/api/v1/auth/mfa/recovery-codes')
        .set(csrfOf(app, session).headers(`${cookieNames.access}=${access}`))
        .expect(201);

      const fresh = (
        regenerated.body as ApiEnvelope<{ recoveryCodes: string[] }>
      ).data!.recoveryCodes;

      expect(fresh).toHaveLength(10);
      expect(fresh).not.toContain(recoveryCodes[2]);

      // An old code is dead even though it was never used.
      const next = await challengeFor(email);
      await verify(next, recoveryCodes[2]!).expect(401);
    });
  });
});
