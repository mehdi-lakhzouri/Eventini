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
import { cookiesConfig } from '../../src/config/cookies.config';
import { TENANT_SCOPED_PRISMA } from '../../src/infrastructure/database/prisma.tokens';
import type { TenantScopedPrismaClient } from '../../src/infrastructure/database/tenant-scope.extension';
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
 * Routes shaped like the business routes sprints 08 to 12 will add, so the
 * isolation they will inherit is proven before any of them exists. A rule
 * demonstrated only on the routes that happen to exist today is a rule that
 * silently stops applying to the next one.
 */
@Controller('isolation-probe')
class IsolationProbeController {
  @Get('organization/:organizationId')
  @RequirePermission('events.read')
  scoped(): { reached: true } {
    return { reached: true };
  }

  @Get('critical')
  @RequireAuthLevel('REAUTHENTICATED')
  critical(): { reached: true } {
    return { reached: true };
  }
}

@Module({ imports: [AppModule], controllers: [IsolationProbeController] })
class IsolationTestModule {}

describeWithDatabase('tenant isolation', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let names: { access: string; refresh: string };
  let versions: PermissionsVersionStore;

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);
  const suffix = unique();

  /** Two real tenants. The "other" one is never a fabricated id. */
  const mine = {
    org: `org_mine${suffix}`,
    user: `usr_mine${suffix}`,
    membership: `mbr_mine${suffix}`,
    email: `mine.${suffix}@eventini.test`,
  };
  const theirs = {
    org: `org_thrs${suffix}`,
    user: `usr_thrs${suffix}`,
    membership: `mbr_thrs${suffix}`,
    email: `theirs.${suffix}@eventini.test`,
  };

  const server = () => app.getHttpServer();

  async function signIn(email: string): Promise<string> {
    const handshake = await preSessionCsrf(app);
    const response = await request(server())
      .post('/api/v1/auth/sessions')
      .set(handshake.headers())
      .send({ email, password: PASSWORD, clientType: 'WEB' })
      .expect(201);

    return `${names.access}=${cookieValue(response, names.access) ?? ''}; ${names.refresh}=${cookieValue(response, names.refresh) ?? ''}`;
  }

  async function grantRole(membership: string, org: string, code: string) {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM roles WHERE code = $1`,
      [code],
    );
    const id = `mra_${unique()}`;
    await pool.query(
      `INSERT INTO membership_role_assignments
         (id, membership_id, organization_id, role_id)
       VALUES ($1, $2, $3, $4)`,
      [id, membership, org, rows[0]!.id],
    );
    await versions.bumpMembership(membership);

    return id;
  }

  async function createTenant(t: typeof mine, hash: string) {
    await pool.query(
      `INSERT INTO organizations (id, name, slug, status, license_plan, is_enabled, updated_at)
       VALUES ($1, 'T', $2, 'ACTIVE', 'free', true, now())`,
      [t.org, `t-${t.org}`],
    );
    await pool.query(
      `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
       VALUES ($1, $2, $2, 'T', 'T', 'ACTIVE', now())`,
      [t.user, t.email],
    );
    await pool.query(
      `INSERT INTO user_credentials (id, user_id, password_hash, updated_at)
       VALUES ($1, $2, $3, now())`,
      [`cred_${unique()}`, t.user, hash],
    );
    await pool.query(
      `INSERT INTO organization_memberships (id, user_id, organization_id, status, updated_at)
       VALUES ($1, $2, $3, 'ACTIVE', now())`,
      [t.membership, t.user, t.org],
    );
  }

  beforeEach(async () => {
    await resetRateLimits();
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [IsolationTestModule],
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

    await createTenant(mine, hash);
    await createTenant(theirs, hash);
    await grantRole(mine.membership, mine.org, 'CLIENT_ADMIN');
    await grantRole(theirs.membership, theirs.org, 'CLIENT_ADMIN');
  });

  afterAll(async () => {
    try {
      const users = [mine.user, theirs.user];
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
        `DELETE FROM membership_role_assignments WHERE membership_id = ANY($1)`,
        [[mine.membership, theirs.membership]],
      );
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
      await pool.query(`DELETE FROM organizations WHERE id = ANY($1)`, [
        [mine.org, theirs.org],
      ]);
    } finally {
      await pool.end();
      await app.close();
    }
  });

  /**
   * 🔴 Sprint 06's exit criterion: a **valid** identifier belonging to another
   * tenant answers 403, never 200.
   *
   * The id used below is a real, active organization with a real, active
   * membership — someone else's. A fabricated string would prove only that the
   * lookup missed, which is a different and much weaker statement.
   */
  describe('a valid identifier from another tenant', () => {
    it('is refused on a scoped route', async () => {
      const jar = await signIn(mine.email);

      const response = await request(server())
        .get(`/api/v1/isolation-probe/organization/${theirs.org}`)
        .set('Cookie', jar);

      expect(response.status).toBe(403);
      expect((response.body as ApiEnvelope<null>).error?.code).toBe(
        'AUTH_TENANT_DENIED',
      );
    });

    it('is accepted when it is the caller’s own', async () => {
      const jar = await signIn(mine.email);

      await request(server())
        .get(`/api/v1/isolation-probe/organization/${mine.org}`)
        .set('Cookie', jar)
        .expect(200);
    });

    /** The same id in the query string, which a path-only check would miss. */
    it('is refused when smuggled through the query string', async () => {
      const jar = await signIn(mine.email);

      const response = await request(server())
        .get(
          `/api/v1/isolation-probe/organization/${mine.org}?organizationId=${theirs.org}`,
        )
        .set('Cookie', jar);

      expect(response.status).toBe(403);
    });

    it('cannot be activated as a context', async () => {
      const jar = await signIn(mine.email);
      const csrf = await preSessionCsrf(app);

      const response = await request(server())
        .post(`/api/v1/organizations/${theirs.org}/activation`)
        .set(csrf.headers(jar))
        .send();

      expect(response.status).toBe(403);
    });

    it('never appears in the caller’s own organization list', async () => {
      const jar = await signIn(mine.email);

      const response = await request(server())
        .get('/api/v1/organizations')
        .set('Cookie', jar)
        .expect(200);

      expect(JSON.stringify(response.body)).not.toContain(theirs.org);
    });
  });

  /**
   * 🔴 ADR-0003's guard, from the inside. A query that forgets its tenant
   * filter must throw rather than return another tenant's rows — the runtime
   * half of the rule the architecture spec enforces statically.
   */
  describe('a deliberately unscoped query', () => {
    it('throws TenantScopeViolationError instead of returning rows', async () => {
      const prisma = app.get<TenantScopedPrismaClient>(TENANT_SCOPED_PRISMA);

      await expect(
        prisma.organizationMembership.findMany({ where: {} }),
      ).rejects.toThrow(/scope/i);
    });

    it('permits the same query inside an explicit $unscoped block', async () => {
      const prisma = app.get<TenantScopedPrismaClient>(TENANT_SCOPED_PRISMA);

      await expect(
        prisma.$unscoped('isolation e2e: proving the escape hatch works', () =>
          prisma.organizationMembership.findMany({ take: 1 }),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('insufficient roles', () => {
    it('refuses a permission the caller’s role does not carry', async () => {
      const jar = await signIn(mine.email);

      const response = await request(server())
        .get('/api/v1/isolation-probe/critical')
        .set('Cookie', jar);

      // CLIENT_ADMIN carries plenty; it does not carry a REAUTHENTICATED
      // session, which is a property of how the caller signed in.
      expect(response.status).toBe(403);
      expect((response.body as ApiEnvelope<null>).error?.code).toBe(
        'AUTH_REAUTHENTICATION_REQUIRED',
      );
    });

    /**
     * 🔴 The token is still valid and still signed. Only the database changed,
     * and the answer changes with it — which no permissions-in-the-token design
     * can do.
     */
    it('refuses immediately when the role is revoked mid-session', async () => {
      // The admin role granted in setup is the one revoked here. Granting a
      // second one would need another ORGANIZATION-scoped role, and INV-09
      // refuses an EVENT-scoped code in this table — correctly.
      const jar = await signIn(mine.email);

      await request(server())
        .get(`/api/v1/isolation-probe/organization/${mine.org}`)
        .set('Cookie', jar)
        .expect(200);

      await pool.query(
        `DELETE FROM membership_role_assignments WHERE membership_id = $1`,
        [mine.membership],
      );
      await versions.bumpMembership(mine.membership);

      const after = await request(server())
        .get(`/api/v1/isolation-probe/organization/${mine.org}`)
        .set('Cookie', jar);

      expect(after.status).toBe(403);

      // Restored for the tests that follow, which assume the admin role.
      await grantRole(mine.membership, mine.org, 'CLIENT_ADMIN');
    });
  });

  /**
   * Step 2 of the chain. A revoked session answers 401 rather than 403: the
   * caller is not a caller any more, which is a different statement from being
   * a caller who may not do this.
   */
  describe('a revoked session', () => {
    it('is refused with 401 even though the token still verifies', async () => {
      const jar = await signIn(mine.email);

      await request(server())
        .get(`/api/v1/isolation-probe/organization/${mine.org}`)
        .set('Cookie', jar)
        .expect(200);

      await pool.query(
        `UPDATE user_sessions SET status = 'REVOKED', revoked_at = now()
          WHERE user_id = $1 AND status = 'ACTIVE'`,
        [mine.user],
      );

      const after = await request(server())
        .get(`/api/v1/isolation-probe/organization/${mine.org}`)
        .set('Cookie', jar);

      expect(after.status).toBe(401);
    });
  });

  /**
   * Steps 4 and 5. Suspending the organization or revoking the membership
   * closes every business route, not merely the ones that check it by hand.
   */
  describe('the tenant itself becoming unusable', () => {
    it('refuses every scoped route once the organization is suspended', async () => {
      const jar = await signIn(mine.email);

      await pool.query(
        `UPDATE organizations SET status = 'SUSPENDED' WHERE id = $1`,
        [mine.org],
      );

      try {
        const response = await request(server())
          .get(`/api/v1/isolation-probe/organization/${mine.org}`)
          .set('Cookie', jar);

        expect([401, 403]).toContain(response.status);
      } finally {
        await pool.query(
          `UPDATE organizations SET status = 'ACTIVE' WHERE id = $1`,
          [mine.org],
        );
      }
    });

    it('refuses once the membership is revoked', async () => {
      const jar = await signIn(mine.email);

      await pool.query(
        `UPDATE organization_memberships SET status = 'REVOKED', revoked_at = now()
          WHERE id = $1`,
        [mine.membership],
      );
      await versions.bumpMembership(mine.membership);

      try {
        const response = await request(server())
          .get(`/api/v1/isolation-probe/organization/${mine.org}`)
          .set('Cookie', jar);

        expect([401, 403]).toContain(response.status);
      } finally {
        await pool.query(
          `UPDATE organization_memberships SET status = 'ACTIVE', revoked_at = NULL
            WHERE id = $1`,
          [mine.membership],
        );
        await versions.bumpMembership(mine.membership);
      }
    });
  });
});
