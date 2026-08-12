import { randomUUID } from 'node:crypto';

import { Controller, Get, Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Pool } from 'pg';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { buildValidationPipe } from '../../src/bootstrap';
import type { ApiEnvelope } from '../../src/common/api';
import { Public } from '../../src/common/decorators';
import { cookiesConfig } from '../../src/config/cookies.config';
import {
  RequireAuthLevel,
  RequirePermission,
} from '../../src/modules/identity/authorization/decorators';
import { PermissionsVersionStore } from '../../src/modules/identity/authorization/domain/permissions-version.store';
import { PasswordHasher } from '../../src/modules/identity/passwords/domain/password-hasher';
import { cookieValue, preSessionCsrf, resetRateLimits } from '../helpers';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

const PASSWORD = 'correct horse battery staple';

/**
 * Routes that exist only here, to ask the chain questions a production route
 * cannot yet ask. Declaring them in the test is deliberate: the point is what
 * happens to a route that carries **no** decorator, and no real controller can
 * demonstrate that without becoming insecure itself.
 */
@Controller('guard-probe')
class GuardProbeController {
  /** No decorator at all. The whole ticket turns on this being protected. */
  @Get('undecorated')
  undecorated(): { reached: true } {
    return { reached: true };
  }

  @Public()
  @Get('public')
  open(): { reached: true } {
    return { reached: true };
  }

  @Get('needs-permission')
  @RequirePermission('events.create')
  needsPermission(): { reached: true } {
    return { reached: true };
  }

  @Get('needs-event-permission/:eventId')
  @RequirePermission('attendance.check_in', 'EVENT')
  needsEventPermission(): { reached: true } {
    return { reached: true };
  }

  @Get('needs-reauthentication')
  @RequireAuthLevel('REAUTHENTICATED')
  needsReauthentication(): { reached: true } {
    return { reached: true };
  }
}

@Module({ imports: [AppModule], controllers: [GuardProbeController] })
class GuardChainTestModule {}

describeWithDatabase('the authorization guard chain', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let names: { access: string; refresh: string };
  let versions: PermissionsVersionStore;

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);
  const suffix = unique();
  const ids = {
    org: `org_g${suffix}`,
    user: `usr_g${suffix}`,
    membership: `mbr_g${suffix}`,
    event: `evt_g${suffix}`,
  };
  const email = `guard.${suffix}@eventini.test`;

  const server = () => app.getHttpServer();
  const probe = (path: string, jar?: string) => {
    const call = request(server()).get(`/api/v1/guard-probe/${path}`);

    return jar === undefined ? call : call.set('Cookie', jar);
  };

  async function signIn(): Promise<string> {
    const handshake = await preSessionCsrf(app);
    const response = await request(server())
      .post('/api/v1/auth/sessions')
      .set(handshake.headers())
      .send({ email, password: PASSWORD, clientType: 'WEB' })
      .expect(201);

    return `${names.access}=${cookieValue(response, names.access) ?? ''}; ${names.refresh}=${cookieValue(response, names.refresh) ?? ''}`;
  }

  async function roleIdOf(code: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM roles WHERE code = $1`,
      [code],
    );

    return rows[0]!.id;
  }

  /**
   * Grants a role and bumps the permissions version, which is what makes the
   * change visible.
   *
   * The bump is not test scaffolding around a defect — it is the contract
   * ADR-0004 defines: the counter moves *inside the transaction* that changes a
   * role. These tests write the assignment with raw SQL because the use case
   * that will own both halves is EVT-044 (sprint 08), so they perform the
   * second half explicitly. Without it the cached set is served until its TTL,
   * which is exactly the staleness the counter exists to prevent.
   */
  async function grantOrganizationRole(code: string): Promise<string> {
    const id = `mra_${unique()}`;
    await pool.query(
      `INSERT INTO membership_role_assignments
         (id, membership_id, organization_id, role_id)
       VALUES ($1, $2, $3, $4)`,
      [id, ids.membership, ids.org, await roleIdOf(code)],
    );
    await versions.bumpMembership(ids.membership);

    return id;
  }

  async function revokeOrganizationRole(assignmentId: string): Promise<void> {
    await pool.query(
      `UPDATE membership_role_assignments SET revoked_at = now() WHERE id = $1`,
      [assignmentId],
    );
    await versions.bumpMembership(ids.membership);
  }

  beforeEach(async () => {
    await resetRateLimits();
    await pool.query(
      `DELETE FROM membership_role_assignments WHERE membership_id = $1`,
      [ids.membership],
    );
    await pool.query(`DELETE FROM event_user_assignments WHERE event_id = $1`, [
      ids.event,
    ]);
    await versions.bumpMembership(ids.membership);
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GuardChainTestModule],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({
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

    versions = app.get(PermissionsVersionStore, { strict: false });

    const hash = await app
      .get(PasswordHasher, { strict: false })
      .hash(PASSWORD);

    pool = new Pool({ connectionString: DATABASE_URL, max: 3 });
    pool.on('error', () => undefined);

    await pool.query(
      `INSERT INTO organizations (id, name, slug, status, license_plan, is_enabled, updated_at)
       VALUES ($1, 'G', $2, 'ACTIVE', 'free', true, now())`,
      [ids.org, `g-${suffix}`],
    );
    await pool.query(
      `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
       VALUES ($1, $2, $2, 'G', 'G', 'ACTIVE', now())`,
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
      [ids.membership, ids.user, ids.org],
    );
    await pool.query(
      `INSERT INTO events
         (id, organization_id, name, slug, status, event_code, timezone,
          starts_at, ends_at, updated_at)
       VALUES ($1, $2, 'G', $3, 'DRAFT', $4, 'UTC',
               now(), now() + interval '1 day', now())`,
      [ids.event, ids.org, `g-${suffix}`, `EG${suffix.slice(0, 6)}`],
    );
  });

  afterAll(async () => {
    try {
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

      await pool.query(
        `DELETE FROM event_user_assignments WHERE event_id = $1`,
        [ids.event],
      );
      await pool.query(
        `DELETE FROM membership_role_assignments WHERE membership_id = $1`,
        [ids.membership],
      );
      await pool.query(`DELETE FROM events WHERE id = $1`, [ids.event]);
      await pool.query(`DELETE FROM user_sessions WHERE user_id = $1`, [
        ids.user,
      ]);
      await pool.query(`DELETE FROM organization_memberships WHERE id = $1`, [
        ids.membership,
      ]);
      await pool.query(`DELETE FROM user_credentials WHERE user_id = $1`, [
        ids.user,
      ]);
      await pool.query(`DELETE FROM users WHERE id = $1`, [ids.user]);
      await pool.query(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
    } finally {
      await pool.end();
      await app.close();
    }
  });

  /**
   * 🔴 The reason the guards are global.
   *
   * With guards applied per route, a forgotten decorator produces a silently
   * open endpoint that answers `200` and that nobody investigates. Inverted,
   * the same forgetfulness produces a `401`, which gets reported.
   */
  describe('a route that declares nothing', () => {
    it('is protected by default', async () => {
      const response = await probe('undecorated');

      expect(response.status).toBe(401);
    });

    it('is reachable once authenticated', async () => {
      const response = await probe('undecorated', await signIn());

      expect(response.status).toBe(200);
    });

    it('opens only when it says @Public()', async () => {
      await probe('public').expect(200);
    });
  });

  describe('@RequirePermission', () => {
    it('refuses a caller whose role does not carry it', async () => {
      const response = await probe('needs-permission', await signIn());

      expect(response.status).toBe(403);
      expect((response.body as ApiEnvelope<null>).error?.code).toBe(
        'AUTH_PERMISSION_DENIED',
      );
    });

    it('admits a caller whose role does', async () => {
      await grantOrganizationRole('CLIENT_ADMIN');

      await probe('needs-permission', await signIn()).expect(200);
    });

    /**
     * 🔴 ADR-0004's decisive test, now reachable end to end: the access token
     * is still valid and still signed, and the answer changes anyway. No
     * approach that carries permissions inside the token can do this.
     */
    it('stops admitting the moment the role is revoked, on the same token', async () => {
      const assignment = await grantOrganizationRole('CLIENT_ADMIN');
      const jar = await signIn();

      await probe('needs-permission', jar).expect(200);

      await revokeOrganizationRole(assignment);

      const after = await probe('needs-permission', jar);

      expect(after.status).toBe(403);
    });
  });

  /**
   * An organization permission does not imply access to every event — §7.3's
   * example, and the reason `EVENT` routes to its own table.
   */
  describe('@RequirePermission with EVENT scope', () => {
    it('refuses an organization admin with no event assignment', async () => {
      await grantOrganizationRole('CLIENT_ADMIN');

      const response = await probe(
        `needs-event-permission/${ids.event}`,
        await signIn(),
      );

      expect(response.status).toBe(403);
    });

    it('admits the same caller once assigned to that event', async () => {
      await grantOrganizationRole('CLIENT_ADMIN');
      await pool.query(
        `INSERT INTO event_user_assignments
           (id, event_id, membership_id, organization_id, assignment_type,
            status, updated_at)
         VALUES ($1, $2, $3, $4, 'SCANNER', 'ACTIVE', now())`,
        [`eua_${unique()}`, ids.event, ids.membership, ids.org],
      );
      // No bump needed: event grants are never cached, because they are bounded
      // by a clock and a cached copy would outlive its own window.

      await probe(`needs-event-permission/${ids.event}`, await signIn()).expect(
        200,
      );
    });
  });

  describe('@RequireAuthLevel', () => {
    it('refuses a PASSWORD session and says what is missing', async () => {
      const response = await probe('needs-reauthentication', await signIn());

      expect(response.status).toBe(403);
      expect((response.body as ApiEnvelope<null>).error?.code).toBe(
        'AUTH_REAUTHENTICATION_REQUIRED',
      );
    });
  });

  /**
   * 🔴 The chain runs in the order §4 fixes, and the order is observable.
   *
   * A caller with no session at all still meets CSRF first on a mutation, and
   * authentication first on a read. If permissions ran before authentication,
   * the second case would answer 403 rather than 401.
   */
  describe('ordering', () => {
    it('answers 401, not 403, when there is no session to check permissions for', async () => {
      const response = await probe('needs-permission');

      expect(response.status).toBe(401);
    });

    it('refuses a mutation with no CSRF token before it looks at the session', async () => {
      const response = await request(server())
        .post('/api/v1/auth/sessions')
        .send({ email, password: PASSWORD, clientType: 'WEB' });

      expect(response.status).toBe(403);
    });
  });
});
