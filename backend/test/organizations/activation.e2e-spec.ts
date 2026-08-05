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
import {
  cookieValue,
  csrfOf,
  preSessionCsrf,
  resetRateLimits,
  type Csrf,
} from '../helpers';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

const PASSWORD = 'correct horse battery staple';

interface OrganizationSummary {
  organizationId: string;
  membershipId: string;
  name: string;
  slug: string;
  active: boolean;
}

interface Session {
  jar: string;
  csrf: Csrf;
  sessionId: string;
  organizationId: string | null;
}

describeWithDatabase('POST /api/v1/organizations/{id}/activation', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let names: { access: string; refresh: string };

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);
  const suffix = unique();

  const ids = {
    orgA: `org_a${suffix}`,
    orgB: `org_b${suffix}`,
    orgSuspended: `org_s${suffix}`,
    orgStranger: `org_x${suffix}`,
    member: `usr_m${suffix}`,
  };
  const email = `switch.${suffix}@eventini.test`;

  const server = () => app.getHttpServer();

  async function signIn(): Promise<Session> {
    const handshake = await preSessionCsrf(app);
    const response = await request(server())
      .post('/api/v1/auth/sessions')
      .set(handshake.headers())
      .send({ email, password: PASSWORD, clientType: 'WEB' })
      .expect(201);

    const body = (
      response.body as ApiEnvelope<{
        sessionId: string;
        organizationId: string | null;
      }>
    ).data!;

    return {
      jar: `${names.access}=${cookieValue(response, names.access) ?? ''}; ${names.refresh}=${cookieValue(response, names.refresh) ?? ''}`,
      csrf: csrfOf(app, response),
      sessionId: body.sessionId,
      organizationId: body.organizationId,
    };
  }

  const activate = (session: Session, organizationId: string) =>
    request(server())
      .post(`/api/v1/organizations/${organizationId}/activation`)
      .set(session.csrf.headers(session.jar))
      .send();

  async function statusOf(sessionId: string): Promise<string> {
    const { rows } = await pool.query<{ status: string }>(
      `SELECT status FROM user_sessions WHERE id = $1`,
      [sessionId],
    );

    return rows[0]?.status ?? 'MISSING';
  }

  async function createOrganization(
    id: string,
    status: string,
    enabled = true,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO organizations (id, name, slug, status, license_plan, is_enabled, updated_at)
       VALUES ($1, $2, $3, $4, 'free', $5, now())`,
      [id, id, `${id}-slug`, status, enabled],
    );
  }

  beforeEach(async () => {
    await resetRateLimits();
  });

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

    await createOrganization(ids.orgA, 'ACTIVE');
    await createOrganization(ids.orgB, 'ACTIVE');
    await createOrganization(ids.orgSuspended, 'SUSPENDED');
    // Real, active, and nothing to do with this user — the id an attacker
    // would forge is a valid one, not a made-up string.
    await createOrganization(ids.orgStranger, 'ACTIVE');

    await pool.query(
      `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
       VALUES ($1, $2, $2, 'S', 'W', 'ACTIVE', now())`,
      [ids.member, email],
    );
    await pool.query(
      `INSERT INTO user_credentials (id, user_id, password_hash, updated_at)
       VALUES ($1, $2, $3, now())`,
      [`cred_${suffix}`, ids.member, hash],
    );

    for (const [index, organizationId] of [
      ids.orgA,
      ids.orgB,
      ids.orgSuspended,
    ].entries()) {
      await pool.query(
        `INSERT INTO organization_memberships (id, user_id, organization_id, status, updated_at)
         VALUES ($1, $2, $3, 'ACTIVE', now())`,
        [`mbr_${index}${suffix}`, ids.member, organizationId],
      );
    }
  });

  afterAll(async () => {
    const purge = await pool.connect();
    try {
      await purge.query('BEGIN');
      await purge.query("SET LOCAL eventini.retention_purge = 'on'");
      await purge.query(
        `DELETE FROM refresh_token_rotations
          WHERE session_id IN (SELECT id FROM user_sessions WHERE user_id = $1)`,
        [ids.member],
      );
      await purge.query('COMMIT');
    } finally {
      purge.release();
    }

    await pool.query(`DELETE FROM user_sessions WHERE user_id = $1`, [
      ids.member,
    ]);
    await pool.query(
      `DELETE FROM organization_memberships WHERE user_id = $1`,
      [ids.member],
    );
    await pool.query(`DELETE FROM user_credentials WHERE user_id = $1`, [
      ids.member,
    ]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [ids.member]);
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1)`, [
      [ids.orgA, ids.orgB, ids.orgSuspended, ids.orgStranger],
    ]);

    await pool.end();
    await app.close();
  });

  describe('GET /organizations', () => {
    it('lists only the organizations the caller can actually work in', async () => {
      const session = await signIn();

      const response = await request(server())
        .get('/api/v1/organizations')
        .set('Cookie', session.jar)
        .expect(200);

      const listed = (response.body as ApiEnvelope<OrganizationSummary[]>)
        .data!;
      const listedIds = listed.map((entry) => entry.organizationId).sort();

      // The suspended one is a real membership and is still excluded: listing
      // it would only advertise a door that answers 403.
      expect(listedIds).toEqual([ids.orgA, ids.orgB].sort());
    });

    it('never lists an organization the caller has no membership in', async () => {
      const session = await signIn();

      const response = await request(server())
        .get('/api/v1/organizations')
        .set('Cookie', session.jar)
        .expect(200);

      expect(JSON.stringify(response.body)).not.toContain(ids.orgStranger);
    });
  });

  describe('switching', () => {
    it('issues a new session scoped to the target organization', async () => {
      const session = await signIn();
      const target = session.organizationId === ids.orgA ? ids.orgB : ids.orgA;

      const response = await activate(session, target).expect(201);
      const body = (
        response.body as ApiEnvelope<{
          sessionId: string;
          organizationId: string;
        }>
      ).data!;

      expect(body.organizationId).toBe(target);
      expect(body.sessionId).not.toBe(session.sessionId);
    });

    /**
     * 🔴 The reason this is a rotation rather than an UPDATE. A refresh token
     * captured before the switch must not survive it.
     */
    it('marks the previous session REPLACED and kills its refresh token', async () => {
      const session = await signIn();
      const target = session.organizationId === ids.orgA ? ids.orgB : ids.orgA;

      await activate(session, target).expect(201);

      expect(await statusOf(session.sessionId)).toBe('REPLACED');

      const { rows } = await pool.query<{ status: string }>(
        `SELECT status FROM refresh_token_rotations WHERE session_id = $1`,
        [session.sessionId],
      );
      expect(rows.every((row) => row.status !== 'ACTIVE')).toBe(true);
    });

    it('leaves the old access token unusable', async () => {
      const session = await signIn();
      const target = session.organizationId === ids.orgA ? ids.orgB : ids.orgA;

      await activate(session, target).expect(201);

      // The old cookie still parses and still verifies as a signature; it is
      // the session behind it that is gone.
      const stale = await request(server())
        .get('/api/v1/auth/me')
        .set('Cookie', session.jar);

      expect(stale.status).toBe(401);
    });

    it('gives the new session a working cookie set', async () => {
      const session = await signIn();
      const target = session.organizationId === ids.orgA ? ids.orgB : ids.orgA;

      const response = await activate(session, target).expect(201);
      const jar = `${names.access}=${cookieValue(response, names.access) ?? ''}`;

      const me = await request(server())
        .get('/api/v1/auth/me')
        .set('Cookie', jar)
        .expect(200);

      expect(
        (me.body as ApiEnvelope<{ organizationId: string }>).data!
          .organizationId,
      ).toBe(target);
    });
  });

  /**
   * 🔴 The sprint's exit criterion, at this route: a valid id belonging to
   * someone else answers 403, never 200.
   */
  describe('refusals', () => {
    it('refuses a real organization the caller has no membership in', async () => {
      const session = await signIn();

      const response = await activate(session, ids.orgStranger);

      expect(response.status).toBe(403);
      expect((response.body as ApiEnvelope<null>).error?.code).toBe(
        'AUTH_TENANT_DENIED',
      );
    });

    it('refuses a suspended organization the caller does belong to', async () => {
      const session = await signIn();

      const response = await activate(session, ids.orgSuspended);

      expect(response.status).toBe(403);
    });

    /**
     * Both refusals are byte-identical. Distinguishing "no membership" from
     * "suspended" would let a caller enumerate which organization ids exist.
     */
    it('answers identically whether the organization exists or not', async () => {
      const session = await signIn();

      const stranger = await activate(session, ids.orgStranger);
      const invented = await activate(session, `org_${unique()}`);

      // `instance` echoes the requested URL and `requestId` is per-request, so
      // both differ by construction and neither says anything about the
      // organization. Everything a caller could learn from is compared.
      const distinguishing = (response: request.Response) => {
        const { instance, ...rest } = (response.body as ApiEnvelope<null>)
          .error!;

        return { status: response.status, error: rest };
      };

      expect(distinguishing(stranger)).toEqual(distinguishing(invented));
    });

    it('leaves the current session intact when it refuses', async () => {
      const session = await signIn();

      await activate(session, ids.orgStranger).expect(403);

      expect(await statusOf(session.sessionId)).toBe('ACTIVE');
    });

    it('refuses an unauthenticated caller', async () => {
      const handshake = await preSessionCsrf(app);

      await request(server())
        .post(`/api/v1/organizations/${ids.orgA}/activation`)
        .set(handshake.headers())
        .send()
        .expect(401);
    });
  });
});
