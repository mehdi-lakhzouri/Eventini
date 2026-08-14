import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

/**
 * Constraint tests against a real PostgreSQL — sprint-03 EVT-014.
 *
 * These run against a live database on purpose. A CHECK constraint, a partial
 * unique index and a trigger are all things only PostgreSQL can be asked
 * about: asserting them from application code would test the application's
 * beliefs rather than the schema. As DATABASE_SCHEMA.md §9 puts it, an
 * invariant upheld only by application code is not an invariant.
 *
 * Raw `pg` rather than Prisma Client, deliberately. Prisma would reject some
 * of these values before they reached the database, which would prove the
 * client validates and leave the schema untested — and the schema is what has
 * to hold when a migration, a script or a console session bypasses the
 * service layer.
 *
 * Skipped when DATABASE_URL is absent so the suite stays runnable on a laptop
 * with nothing started; CI provides a PostgreSQL service.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

describeWithDatabase('identity schema constraints', () => {
  let pool: Pool;

  const ids = {
    user: '',
    otherUser: '',
    organization: '',
    membership: '',
    organizationRole: '',
    platformRole: '',
  };

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    pool.on('error', () => undefined);

    const suffix = unique();
    ids.user = `usr_${suffix}`;
    ids.otherUser = `usr_o${suffix}`;
    ids.organization = `org_${suffix}`;
    ids.membership = `mbr_${suffix}`;
    ids.organizationRole = `rol_org_${suffix}`;
    ids.platformRole = `rol_plt_${suffix}`;

    await pool.query(
      `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
       VALUES ($1, $2, $2, 'Test', 'User', 'ACTIVE', now()), ($3, $4, $4, 'Other', 'User', 'ACTIVE', now())`,
      [
        ids.user,
        `${suffix}@example.com`,
        ids.otherUser,
        `o${suffix}@example.com`,
      ],
    );
    await pool.query(
      `INSERT INTO organizations (id, name, slug, status, license_plan, updated_at)
       VALUES ($1, 'Test Org', $2, 'ACTIVE', 'free', now())`,
      [ids.organization, `slug-${suffix}`],
    );
    await pool.query(
      `INSERT INTO organization_memberships (id, user_id, organization_id, status, updated_at)
       VALUES ($1, $2, $3, 'ACTIVE', now())`,
      [ids.membership, ids.user, ids.organization],
    );
    await pool.query(
      `INSERT INTO roles (id, code, name, scope, is_system, updated_at)
       VALUES ($1, $2, 'Org Role', 'ORGANIZATION', true, now()),
              ($3, $4, 'Platform Role', 'PLATFORM', true, now())`,
      [
        ids.organizationRole,
        `ORG_ROLE_${suffix}`,
        ids.platformRole,
        `PLATFORM_ROLE_${suffix}`,
      ],
    );
  });

  afterAll(async () => {
    // Reverse dependency order.
    await pool.query(
      `DELETE FROM platform_role_assignments WHERE user_id = ANY($1)`,
      [[ids.user, ids.otherUser]],
    );
    await pool.query(
      `DELETE FROM membership_role_assignments WHERE membership_id = $1`,
      [ids.membership],
    );
    await pool.query(`DELETE FROM organization_memberships WHERE id = $1`, [
      ids.membership,
    ]);
    await pool.query(`DELETE FROM roles WHERE id = ANY($1)`, [
      [ids.organizationRole, ids.platformRole],
    ]);
    await pool.query(`DELETE FROM organizations WHERE id = $1`, [
      ids.organization,
    ]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [
      [ids.user, ids.otherUser],
    ]);
    await pool.end();
  });

  describe('CHECK constraints (§2.2)', () => {
    it('rejects a user status outside the allowed set', async () => {
      await expect(
        pool.query(
          `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
           VALUES ($1, 'x@example.com', 'x@example.com', 'A', 'B', 'NOT_A_STATUS', now())`,
          [`usr_bad_${unique()}`],
        ),
      ).rejects.toThrow(/ck_users_status/);
    });

    it('rejects an organization status outside the allowed set', async () => {
      await expect(
        pool.query(
          `INSERT INTO organizations (id, name, slug, status, license_plan, updated_at)
           VALUES ($1, 'X', $2, 'NOPE', 'free', now())`,
          [`org_bad_${unique()}`, `bad-${unique()}`],
        ),
      ).rejects.toThrow(/ck_organizations_status/);
    });

    it('rejects a membership status outside the allowed set', async () => {
      await expect(
        pool.query(
          `INSERT INTO organization_memberships (id, user_id, organization_id, status, updated_at)
           VALUES ($1, $2, $3, 'NOPE', now())`,
          [`mbr_bad_${unique()}`, ids.otherUser, ids.organization],
        ),
      ).rejects.toThrow(/ck_memberships_status/);
    });

    it('rejects a role scope outside the allowed set', async () => {
      await expect(
        pool.query(
          `INSERT INTO roles (id, code, name, scope, is_system, updated_at)
           VALUES ($1, $2, 'Bad', 'GALAXY', true, now())`,
          [`rol_bad_${unique()}`, `BAD_${unique()}`],
        ),
      ).rejects.toThrow(/ck_roles_scope/);
    });
  });

  describe('partial unique indexes on soft-deleted tables (§2.5)', () => {
    it('rejects a second live user with the same normalized email', async () => {
      const email = `dup-${unique()}@example.com`;
      const first = `usr_d1_${unique()}`;

      await pool.query(
        `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
         VALUES ($1, $2, $2, 'A', 'B', 'ACTIVE', now())`,
        [first, email],
      );

      await expect(
        pool.query(
          `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
           VALUES ($1, $2, $2, 'C', 'D', 'ACTIVE', now())`,
          [`usr_d2_${unique()}`, email],
        ),
      ).rejects.toThrow(/ux_users_normalized_email_active/);

      await pool.query(`DELETE FROM users WHERE id = $1`, [first]);
    });

    /**
     * The reason the index is partial. With a plain unique index a deleted
     * account would reserve its email address forever, so the person could
     * never register again with the same address.
     */
    it('allows the email to be reused once the first user is soft-deleted', async () => {
      const email = `reuse-${unique()}@example.com`;
      const first = `usr_r1_${unique()}`;
      const second = `usr_r2_${unique()}`;

      await pool.query(
        `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
         VALUES ($1, $2, $2, 'A', 'B', 'ACTIVE', now())`,
        [first, email],
      );
      await pool.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [
        first,
      ]);

      await expect(
        pool.query(
          `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
           VALUES ($1, $2, $2, 'C', 'D', 'ACTIVE', now())`,
          [second, email],
        ),
      ).resolves.toBeDefined();

      await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [
        [first, second],
      ]);
    });
  });

  /**
   * INV-09. A PLATFORM-scoped role granted through a membership would hand
   * platform-wide authority to anyone able to administer one organization —
   * the most direct privilege-escalation path in the model, which is why
   * §5.6 requires a trigger and not just application code.
   */
  describe('INV-09 role scope triggers (§5.6)', () => {
    it('blocks a PLATFORM role from being granted through a membership', async () => {
      await expect(
        pool.query(
          `INSERT INTO membership_role_assignments (id, membership_id, role_id)
           VALUES ($1, $2, $3)`,
          [`mra_bad_${unique()}`, ids.membership, ids.platformRole],
        ),
      ).rejects.toThrow(/INV-09/);
    });

    it('allows an ORGANIZATION role through a membership', async () => {
      const id = `mra_ok_${unique()}`;

      await expect(
        pool.query(
          `INSERT INTO membership_role_assignments (id, membership_id, role_id)
           VALUES ($1, $2, $3)`,
          [id, ids.membership, ids.organizationRole],
        ),
      ).resolves.toBeDefined();

      await pool.query(
        `DELETE FROM membership_role_assignments WHERE id = $1`,
        [id],
      );
    });

    it('blocks a non-PLATFORM role from platform_role_assignments', async () => {
      await expect(
        pool.query(
          `INSERT INTO platform_role_assignments (id, user_id, role_id, status, updated_at)
           VALUES ($1, $2, $3, 'ACTIVE', now())`,
          [`pra_bad_${unique()}`, ids.user, ids.organizationRole],
        ),
      ).rejects.toThrow(/INV-09/);
    });

    it('allows a PLATFORM role in platform_role_assignments', async () => {
      const id = `pra_ok_${unique()}`;

      await expect(
        pool.query(
          `INSERT INTO platform_role_assignments (id, user_id, role_id, status, updated_at)
           VALUES ($1, $2, $3, 'ACTIVE', now())`,
          [id, ids.user, ids.platformRole],
        ),
      ).resolves.toBeDefined();

      await pool.query(`DELETE FROM platform_role_assignments WHERE id = $1`, [
        id,
      ]);
    });

    it('blocks an UPDATE that swaps in a role of the wrong scope', async () => {
      const id = `mra_up_${unique()}`;
      await pool.query(
        `INSERT INTO membership_role_assignments (id, membership_id, role_id)
         VALUES ($1, $2, $3)`,
        [id, ids.membership, ids.organizationRole],
      );

      await expect(
        pool.query(
          `UPDATE membership_role_assignments SET role_id = $2 WHERE id = $1`,
          [id, ids.platformRole],
        ),
      ).rejects.toThrow(/INV-09/);

      await pool.query(
        `DELETE FROM membership_role_assignments WHERE id = $1`,
        [id],
      );
    });
  });

  /**
   * These rows are never deleted, only revoked, so a plain unique index would
   * let a role be granted to a membership exactly once for its whole
   * lifetime — re-granting after a revocation would collide with the revoked
   * row.
   */
  describe('partial unique on REVOKE_NOT_DELETE tables (§2.5)', () => {
    it('allows re-granting a role after the previous grant is revoked', async () => {
      const first = `mra_v1_${unique()}`;
      const second = `mra_v2_${unique()}`;

      await pool.query(
        `INSERT INTO membership_role_assignments (id, membership_id, role_id)
         VALUES ($1, $2, $3)`,
        [first, ids.membership, ids.organizationRole],
      );

      await expect(
        pool.query(
          `INSERT INTO membership_role_assignments (id, membership_id, role_id)
           VALUES ($1, $2, $3)`,
          [second, ids.membership, ids.organizationRole],
        ),
      ).rejects.toThrow(/ux_membership_role_active/);

      await pool.query(
        `UPDATE membership_role_assignments SET revoked_at = now() WHERE id = $1`,
        [first],
      );

      await expect(
        pool.query(
          `INSERT INTO membership_role_assignments (id, membership_id, role_id)
           VALUES ($1, $2, $3)`,
          [second, ids.membership, ids.organizationRole],
        ),
      ).resolves.toBeDefined();

      await pool.query(
        `DELETE FROM membership_role_assignments WHERE id = ANY($1)`,
        [[first, second]],
      );
    });
  });
});
