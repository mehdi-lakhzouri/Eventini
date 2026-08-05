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
import { preSessionCsrf, resetRateLimits } from '../helpers';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

const PASSWORD = 'correct horse battery staple';

describeWithDatabase('POST /api/v1/auth/sessions', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let cookieNames: { access: string; refresh: string };
  let csrfNames: { token: string; context: string };

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);
  const suffix = unique();

  const ids = {
    orgA: `org_a${suffix}`,
    orgB: `org_b${suffix}`,
    solo: `usr_solo${suffix}`,
    multi: `usr_multi${suffix}`,
    suspended: `usr_susp${suffix}`,
    orphan: `usr_orphan${suffix}`,
    suspendedOrg: `usr_sorg${suffix}`,
  };

  const emailOf = (key: string): string => `${key}.${suffix}@eventini.test`;

  async function createUser(
    id: string,
    email: string,
    status: string,
    passwordHash: string,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
       VALUES ($1, $2, $2, 'A', 'B', $3, now())`,
      [id, email.toLowerCase(), status],
    );
    await pool.query(
      `INSERT INTO user_credentials (id, user_id, password_hash, updated_at)
       VALUES ($1, $2, $3, now())`,
      [`cred_${unique()}`, id, passwordHash],
    );
  }

  async function addMembership(
    userId: string,
    organizationId: string,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO organization_memberships (id, user_id, organization_id, status, updated_at)
       VALUES ($1, $2, $3, 'ACTIVE', now())`,
      [`mbr_${unique()}`, userId, organizationId],
    );
  }

  /** Login is never exempt from CSRF, so every call does the handshake first. */
  async function login(body: Record<string, unknown>) {
    const csrf = await preSessionCsrf(app);

    return request(app.getHttpServer())
      .post('/api/v1/auth/sessions')
      .set(csrf.headers())
      .send(body);
  }

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

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: false,
    });
    const cookies = app.get<ConfigType<typeof cookiesConfig>>(
      cookiesConfig.KEY,
    );

    // Without the parser every cookie-reading route refuses the request for
    // the wrong reason — `request.cookies` would simply not exist.
    app.use(cookieParser(cookies.secret));
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();

    cookieNames = {
      access: cookies.access.name,
      refresh: cookies.refresh.name,
    };
    csrfNames = { token: cookies.csrf.name, context: cookies.csrfContext.name };

    const hash = await app
      .get(PasswordHasher, { strict: false })
      .hash(PASSWORD);

    pool = new Pool({ connectionString: DATABASE_URL, max: 3 });
    pool.on('error', () => undefined);

    await pool.query(
      `INSERT INTO organizations (id, name, slug, status, license_plan, is_enabled, updated_at)
       VALUES ($1, 'A', $2, 'ACTIVE', 'free', true, now()),
              ($3, 'B', $4, 'SUSPENDED', 'free', true, now())`,
      [ids.orgA, `a-${suffix}`, ids.orgB, `b-${suffix}`],
    );

    await createUser(ids.solo, emailOf('solo'), 'ACTIVE', hash);
    await createUser(ids.multi, emailOf('multi'), 'ACTIVE', hash);
    await createUser(ids.suspended, emailOf('suspended'), 'SUSPENDED', hash);
    await createUser(ids.orphan, emailOf('orphan'), 'ACTIVE', hash);
    await createUser(ids.suspendedOrg, emailOf('sorg'), 'ACTIVE', hash);

    await addMembership(ids.solo, ids.orgA);
    await addMembership(ids.multi, ids.orgA);
    // A second usable organization for the ambiguous case.
    await pool.query(
      `INSERT INTO organizations (id, name, slug, status, license_plan, is_enabled, updated_at)
       VALUES ($1, 'C', $2, 'ACTIVE', 'free', true, now())`,
      [`org_c${suffix}`, `c-${suffix}`],
    );
    await addMembership(ids.multi, `org_c${suffix}`);
    await addMembership(ids.suspended, ids.orgA);
    await addMembership(ids.suspendedOrg, ids.orgB);
  });

  // The limiter is shared state: without this a suite that signs in many times
  // exhausts the per-IP login window and fails for a reason that has nothing
  // to do with what it is testing. See `resetRateLimits`.
  beforeEach(async () => {
    await resetRateLimits();
  });

  afterAll(async () => {
    const users = [
      ids.solo,
      ids.multi,
      ids.suspended,
      ids.orphan,
      ids.suspendedOrg,
    ];
    const orgs = [ids.orgA, ids.orgB, `org_c${suffix}`];

    // refresh_token_rotations is APPEND_ONLY, so removing rows needs the same
    // retention escape the audit tables use — a transaction-scoped flag that
    // has to be set deliberately.
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
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1)`, [orgs]);

    await pool.end();
    await app.close();
  });

  describe('a valid login', () => {
    it('creates a session scoped to the only usable organization', async () => {
      const response = await login({
        email: emailOf('solo'),
        password: PASSWORD,
        clientType: 'WEB',
      });

      expect(response.status).toBe(201);

      const body = response.body as ApiEnvelope<{
        userId: string;
        organizationId: string | null;
        requiresOrganizationSelection: boolean;
      }>;

      expect(body.data?.userId).toBe(ids.solo);
      expect(body.data?.organizationId).toBe(ids.orgA);
      expect(body.data?.requiresOrganizationSelection).toBe(false);
    });

    it('persists the session and its first refresh token together', async () => {
      const response = await login({
        email: emailOf('solo'),
        password: PASSWORD,
        clientType: 'WEB',
      });
      const sessionId = (response.body as ApiEnvelope<{ sessionId: string }>)
        .data?.sessionId;

      const rows = await pool.query<{
        status: string;
        rotation_status: string;
      }>(
        `SELECT s.status, r.status AS rotation_status
           FROM user_sessions s
           JOIN refresh_token_rotations r ON r.session_id = s.id
          WHERE s.id = $1`,
        [sessionId],
      );

      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]?.status).toBe('ACTIVE');
      expect(rows.rows[0]?.rotation_status).toBe('ACTIVE');
    });

    /** AUTH-INV-001: neither token may be readable by JavaScript. */
    it('returns both tokens as httpOnly cookies and neither in the body', async () => {
      const response = await login({
        email: emailOf('solo'),
        password: PASSWORD,
        clientType: 'WEB',
      });
      const cookies = response.headers['set-cookie'] as unknown as string[];
      const of = (name: string) =>
        cookies.find((cookie) => cookie.startsWith(`${name}=`)) ?? '';

      expect(of(cookieNames.access)).toContain('HttpOnly');
      expect(of(cookieNames.refresh)).toContain('HttpOnly');
      // The rebound CSRF token is the one cookie JavaScript may read, and it
      // authorizes nothing on its own.
      expect(of(csrfNames.token)).not.toContain('HttpOnly');
      expect(of(csrfNames.context)).toContain('HttpOnly');

      // A JWT always starts eyJ; finding one in the body would mean a token
      // that JavaScript can read.
      expect(JSON.stringify(response.body)).not.toContain('eyJ');
    });

    it('stores the refresh token hashed, never in the clear', async () => {
      const response = await login({
        email: emailOf('solo'),
        password: PASSWORD,
        clientType: 'WEB',
      });
      const refresh = cookieValue(response, cookieNames.refresh);

      expect(refresh).toBeDefined();

      const stored = await pool.query<{ token_hash: string }>(
        `SELECT r.token_hash FROM refresh_token_rotations r
          WHERE r.session_id = $1`,
        [(response.body as ApiEnvelope<{ sessionId: string }>).data?.sessionId],
      );

      expect(stored.rows[0]?.token_hash).not.toBe(refresh);
      expect(stored.rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('scopes the refresh cookie away from the rest of the API', async () => {
      const response = await login({
        email: emailOf('solo'),
        password: PASSWORD,
        clientType: 'WEB',
      });
      const cookies = response.headers['set-cookie'] as unknown as string[];
      const refresh = cookies.find((cookie) =>
        cookie.startsWith(cookieNames.refresh),
      );

      expect(refresh).toContain('Path=/api/v1/auth');
    });

    it('records the login on the user', async () => {
      await login({
        email: emailOf('solo'),
        password: PASSWORD,
        clientType: 'WEB',
      });

      const row = await pool.query<{ last_login_at: Date | null }>(
        `SELECT last_login_at FROM users WHERE id = $1`,
        [ids.solo],
      );

      expect(row.rows[0]?.last_login_at).not.toBeNull();
    });

    it('creates an unscoped session when several organizations are usable', async () => {
      const response = await login({
        email: emailOf('multi'),
        password: PASSWORD,
        clientType: 'WEB',
      });
      const body = response.body as ApiEnvelope<{
        organizationId: string | null;
        requiresOrganizationSelection: boolean;
      }>;

      expect(response.status).toBe(201);
      expect(body.data?.organizationId).toBeNull();
      expect(body.data?.requiresOrganizationSelection).toBe(true);
    });

    it('normalizes the email, so case and spacing do not matter', async () => {
      const response = await login({
        email: `  ${emailOf('solo').toUpperCase()} `,
        password: PASSWORD,
        clientType: 'WEB',
      });

      expect(response.status).toBe(201);
    });
  });

  /**
   * Every one of these must produce the same response. A caller who can tell
   * them apart can enumerate accounts and read their status.
   */
  describe('refusals are indistinguishable', () => {
    it.each([
      ['an unknown account', () => `nobody.${suffix}@eventini.test`],
      ['a suspended user', () => emailOf('suspended')],
      ['a user whose only organization is suspended', () => emailOf('sorg')],
    ])('refuses %s with the generic 401', async (_label, email) => {
      const response = await login({
        email: email(),
        password: PASSWORD,
        clientType: 'WEB',
      });

      expect(response.status).toBe(401);
      expect((response.body as ApiEnvelope<never>).error?.code).toBe(
        'AUTH_INVALID_CREDENTIALS',
      );
    });

    it('refuses a wrong password with the same response', async () => {
      const response = await login({
        email: emailOf('solo'),
        password: 'not the password',
        clientType: 'WEB',
      });

      expect(response.status).toBe(401);
      expect((response.body as ApiEnvelope<never>).error?.code).toBe(
        'AUTH_INVALID_CREDENTIALS',
      );
    });

    it('never answers AUTH_ACCOUNT_LOCKED', async () => {
      const response = await login({
        email: emailOf('suspended'),
        password: PASSWORD,
        clientType: 'WEB',
      });

      expect(JSON.stringify(response.body)).not.toContain('LOCKED');
    });

    it('sets no cookie when it refuses', async () => {
      const response = await login({
        email: emailOf('solo'),
        password: 'wrong',
        clientType: 'WEB',
      });

      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('writes no session when it refuses', async () => {
      const before = await pool.query<{ count: string }>(
        `SELECT count(*) AS count FROM user_sessions WHERE user_id = $1`,
        [ids.suspended],
      );

      await login({
        email: emailOf('suspended'),
        password: PASSWORD,
        clientType: 'WEB',
      });

      const after = await pool.query<{ count: string }>(
        `SELECT count(*) AS count FROM user_sessions WHERE user_id = $1`,
        [ids.suspended],
      );

      expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
    });

    /** No membership and no platform role: nowhere to sign in to. */
    it('refuses a user with no access at all', async () => {
      const response = await login({
        email: emailOf('orphan'),
        password: PASSWORD,
        clientType: 'WEB',
      });

      expect(response.status).toBe(403);
      expect((response.body as ApiEnvelope<never>).error?.code).toBe(
        'AUTH_TENANT_DENIED',
      );
    });
  });

  describe('request validation', () => {
    it.each([
      ['a missing password', { email: 'a@b.test', clientType: 'WEB' }],
      ['a missing email', { password: PASSWORD, clientType: 'WEB' }],
      [
        'an unknown client type',
        { email: 'a@b.test', password: PASSWORD, clientType: 'TOASTER' },
      ],
      [
        'an unexpected field',
        {
          email: 'a@b.test',
          password: PASSWORD,
          clientType: 'WEB',
          isAdmin: true,
        },
      ],
    ])('rejects %s', async (_label, body) => {
      const response = await login(body);

      expect(response.status).toBe(400);
    });
  });
});
