import { Pool } from 'pg';

import {
  ASSIGNMENT_TYPES,
  PERMISSIONS,
  ROLES,
} from '../../prisma/seed/authorization-catalogue';
import { seedPermissions } from '../../prisma/seed/01-permissions.seed';
import { seedRoles } from '../../prisma/seed/02-roles.seed';
import { seedRolePermissions } from '../../prisma/seed/03-role-permissions.seed';
import { bootstrapSuperAdmin } from '../../prisma/seed/04-bootstrap-super-admin.seed';
import {
  createSeedClient,
  type SeedClient,
} from '../../prisma/seed/seed-client';
import { isNoOp, type SeedOutcome } from '../../prisma/seed/seed-outcome';

/**
 * The seed, against real PostgreSQL — sprint-03 EVT-017.
 *
 * The catalogue's own unit spec proves it is self-consistent. That says
 * nothing about what actually lands in the database: whether the CHECK
 * constraints accept the scopes, whether the reconciliation converges, or
 * whether a second run is genuinely a no-op rather than a set of writes that
 * happen to produce equal values. Those are questions only PostgreSQL can
 * answer, so they are asked here.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

const EXPECTED_GRANTS = ROLES.reduce(
  (total, role) => total + role.permissions.length,
  0,
);

describeWithDatabase('authorization seed', () => {
  let prisma: SeedClient;
  let pool: Pool;

  async function runReferenceSeed(): Promise<readonly SeedOutcome[]> {
    return prisma.$transaction(async (tx) => [
      await seedPermissions(tx),
      await seedRoles(tx),
      await seedRolePermissions(tx),
    ]);
  }

  async function count(table: string): Promise<number> {
    const result = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM ${table}`,
    );
    return Number(result.rows[0]?.n ?? '0');
  }

  beforeAll(async () => {
    prisma = createSeedClient(DATABASE_URL as string);
    pool = new Pool({ connectionString: DATABASE_URL });

    // The suite runs against a database that may already be seeded, which is
    // the realistic case: a seed's job is to converge, not to require a blank
    // slate. `beforeAll` therefore establishes the seeded state instead of
    // asserting the absence of one.
    await runReferenceSeed();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  describe('reference data', () => {
    it('writes every catalogue permission', async () => {
      const rows = await pool.query<{ code: string }>(
        `SELECT code FROM permissions`,
      );

      // Compared as sets, not as ordered lists: PostgreSQL orders under the
      // database collation, where `_` does not sort where JavaScript's
      // code-point comparison puts it, so `event_sessions.manage` and
      // `events.create` swap places. That difference is about collation and
      // says nothing about the seed.
      expect(new Set(rows.rows.map((row) => row.code))).toEqual(
        new Set(PERMISSIONS.map((permission) => permission.code)),
      );
      expect(rows.rows).toHaveLength(PERMISSIONS.length);
    });

    it('writes the six system roles with is_system set', async () => {
      const rows = await pool.query<{ code: string; is_system: boolean }>(
        `SELECT code, is_system FROM roles ORDER BY code`,
      );

      expect(rows.rows).toHaveLength(ROLES.length);
      for (const row of rows.rows) {
        expect(row.is_system).toBe(true);
      }
    });

    it('writes exactly the grants the matrix declares', async () => {
      expect(await count('role_permissions')).toBe(EXPECTED_GRANTS);
    });

    /**
     * `ck_roles_scope` would reject an unknown scope, so this passing at all
     * means the catalogue's scopes are values the database recognises — the
     * drift `enums.spec.ts` guards in the other direction.
     */
    it('stores each role at its catalogue scope', async () => {
      const rows = await pool.query<{ code: string; scope: string }>(
        `SELECT code, scope FROM roles`,
      );
      const scopeByCode = new Map(
        rows.rows.map((row) => [row.code, row.scope]),
      );

      for (const role of ROLES) {
        expect(scopeByCode.get(role.code)).toBe(role.scope);
      }
    });
  });

  /**
   * ENTITY_RELATIONSHIPS.md §4.4 resolves an event permission by joining
   * `event_user_assignments.assignment_type` to `roles.code` where
   * `roles.scope = 'EVENT'`. Asserting the join in SQL rather than over the
   * TypeScript constants is the point: it is the query the authorization
   * chain will actually run.
   */
  describe('event assignment types resolve to a role', () => {
    it.each([...ASSIGNMENT_TYPES])(
      'resolves assignment_type %s',
      async (type) => {
        const rows = await pool.query(
          `SELECT id FROM roles WHERE code = $1 AND scope = 'EVENT'`,
          [type],
        );

        expect(rows.rowCount).toBe(1);
      },
    );
  });

  describe('idempotency', () => {
    it('changes nothing on a second run', async () => {
      const outcomes = await runReferenceSeed();

      expect(isNoOp(outcomes)).toBe(true);
    });

    /**
     * The assertion a blind `upsert` would fail. Row contents would still
     * match; `updated_at` would not, because Prisma's `@updatedAt` fires on
     * every write. That would make "when did this permission last change"
     * unanswerable, and it is the reason the steps diff before writing.
     */
    it('leaves updated_at untouched on a second run', async () => {
      const before = await pool.query<{ code: string; updated_at: Date }>(
        `SELECT code, updated_at FROM permissions ORDER BY code`,
      );

      await runReferenceSeed();

      const after = await pool.query<{ code: string; updated_at: Date }>(
        `SELECT code, updated_at FROM permissions ORDER BY code`,
      );

      expect(after.rows).toEqual(before.rows);
    });

    it('restores a grant deleted out from under it, and only that grant', async () => {
      const victim = await pool.query<{
        role_id: string;
        permission_id: string;
      }>(
        `SELECT rp.role_id, rp.permission_id
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
          WHERE r.code = 'SCANNER'
          LIMIT 1`,
      );
      const row = victim.rows[0];
      expect(row).toBeDefined();

      await pool.query(
        `DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2`,
        [row?.role_id, row?.permission_id],
      );

      const outcomes = await runReferenceSeed();

      expect(await count('role_permissions')).toBe(EXPECTED_GRANTS);
      expect(
        outcomes.find((entry) => entry.step === 'role_permissions')?.created,
      ).toBe(1);
      expect(
        outcomes.find((entry) => entry.step === 'role_permissions')?.removed,
      ).toBe(0);
    });

    /**
     * The revocation half of the reconciliation. A grant that is not in the
     * catalogue must actually disappear — a seed that can only add is a
     * one-way ratchet on privilege.
     */
    it('revokes a grant that the catalogue does not declare', async () => {
      const [role, permission] = await Promise.all([
        pool.query<{ id: string }>(
          `SELECT id FROM roles WHERE code = 'SCANNER'`,
        ),
        pool.query<{ id: string }>(
          `SELECT id FROM permissions WHERE code = 'platform.kill_switch.execute'`,
        ),
      ]);

      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`,
        [role.rows[0]?.id, permission.rows[0]?.id],
      );

      const outcomes = await runReferenceSeed();

      expect(
        outcomes.find((entry) => entry.step === 'role_permissions')?.removed,
      ).toBe(1);
      expect(await count('role_permissions')).toBe(EXPECTED_GRANTS);
    });

    it('repairs a role whose scope was changed underneath it', async () => {
      await pool.query(
        `UPDATE roles SET scope = 'ORGANIZATION' WHERE code = 'SCANNER'`,
      );

      const outcomes = await runReferenceSeed();

      const scope = await pool.query<{ scope: string }>(
        `SELECT scope FROM roles WHERE code = 'SCANNER'`,
      );

      expect(scope.rows[0]?.scope).toBe('EVENT');
      expect(outcomes.find((entry) => entry.step === 'roles')?.updated).toBe(1);
    });

    it('restores is_system on a role that was demoted', async () => {
      await pool.query(
        `UPDATE roles SET is_system = false WHERE code = 'CLIENT_ADMIN'`,
      );

      await runReferenceSeed();

      const row = await pool.query<{ is_system: boolean }>(
        `SELECT is_system FROM roles WHERE code = 'CLIENT_ADMIN'`,
      );

      expect(row.rows[0]?.is_system).toBe(true);
    });
  });

  /**
   * 🔴 The single most important assertion in this file.
   *
   * The ticket forbids a seed from writing a password, including in
   * development, because a seeded password reaches production every time.
   * This test fails the build if anyone ever "helpfully" adds one.
   */
  describe('bootstrap super admin', () => {
    const email = `evt017.bootstrap.${String(Date.now())}@eventini.test`;
    const previousEmail = process.env['BOOTSTRAP_SUPER_ADMIN_EMAIL'];

    afterAll(async () => {
      if (previousEmail === undefined) {
        delete process.env['BOOTSTRAP_SUPER_ADMIN_EMAIL'];
      } else {
        process.env['BOOTSTRAP_SUPER_ADMIN_EMAIL'] = previousEmail;
      }

      await pool.query(
        `DELETE FROM platform_role_assignments
          WHERE user_id IN (SELECT id FROM users WHERE normalized_email = $1)`,
        [email.toLowerCase()],
      );
      await pool.query(`DELETE FROM users WHERE normalized_email = $1`, [
        email.toLowerCase(),
      ]);
    });

    it('creates the account PENDING and with no credential at all', async () => {
      process.env['BOOTSTRAP_SUPER_ADMIN_EMAIL'] = email;

      const credentialsBefore = await count('user_credentials');

      await prisma.$transaction(async (tx) => bootstrapSuperAdmin(tx));

      const user = await pool.query<{ id: string; status: string }>(
        `SELECT id, status FROM users WHERE normalized_email = $1`,
        [email.toLowerCase()],
      );

      expect(user.rows[0]?.status).toBe('PENDING');
      expect(await count('user_credentials')).toBe(credentialsBefore);

      const credential = await pool.query(
        `SELECT 1 FROM user_credentials WHERE user_id = $1`,
        [user.rows[0]?.id],
      );
      expect(credential.rowCount).toBe(0);
    });

    it('grants SUPER_ADMIN through platform_role_assignments, ACTIVE', async () => {
      process.env['BOOTSTRAP_SUPER_ADMIN_EMAIL'] = email;
      await prisma.$transaction(async (tx) => bootstrapSuperAdmin(tx));

      const grant = await pool.query<{ code: string; status: string }>(
        `SELECT r.code, pra.status
           FROM platform_role_assignments pra
           JOIN roles r ON r.id = pra.role_id
           JOIN users u ON u.id = pra.user_id
          WHERE u.normalized_email = $1`,
        [email.toLowerCase()],
      );

      expect(grant.rows).toEqual([{ code: 'SUPER_ADMIN', status: 'ACTIVE' }]);
    });

    it('is idempotent — a second run adds no second grant', async () => {
      process.env['BOOTSTRAP_SUPER_ADMIN_EMAIL'] = email;

      const result = await prisma.$transaction(async (tx) =>
        bootstrapSuperAdmin(tx),
      );

      expect(result.seedOutcome.created).toBe(0);

      const grants = await pool.query(
        `SELECT 1 FROM platform_role_assignments pra
           JOIN users u ON u.id = pra.user_id
          WHERE u.normalized_email = $1`,
        [email.toLowerCase()],
      );
      expect(grants.rowCount).toBe(1);
    });

    it('does nothing when no bootstrap address is configured', async () => {
      delete process.env['BOOTSTRAP_SUPER_ADMIN_EMAIL'];

      const usersBefore = await count('users');
      const result = await prisma.$transaction(async (tx) =>
        bootstrapSuperAdmin(tx),
      );

      expect(result.seedOutcome.created).toBe(0);
      expect(result.operatorNotice).toEqual([]);
      expect(await count('users')).toBe(usersBefore);
    });

    /**
     * The operator notice is printed to stdout and lands in CI logs. It must
     * carry no secret, because it will be readable by everyone with access to
     * a build.
     */
    it('prints a notice containing no credential', async () => {
      const second = `evt017.notice.${String(Date.now())}@eventini.test`;
      process.env['BOOTSTRAP_SUPER_ADMIN_EMAIL'] = second;

      const result = await prisma.$transaction(async (tx) =>
        bootstrapSuperAdmin(tx),
      );
      const notice = result.operatorNotice.join('\n');

      expect(notice).toContain('CANNOT SIGN IN YET');
      expect(notice.toLowerCase()).not.toMatch(/password[:=]|token[:=]|secret/);

      await pool.query(
        `DELETE FROM platform_role_assignments
          WHERE user_id IN (SELECT id FROM users WHERE normalized_email = $1)`,
        [second.toLowerCase()],
      );
      await pool.query(`DELETE FROM users WHERE normalized_email = $1`, [
        second.toLowerCase(),
      ]);
    });
  });
});
