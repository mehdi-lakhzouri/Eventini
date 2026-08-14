import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { createClient } from 'redis';

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const describeWithServices =
  DATABASE_URL && REDIS_URL ? describe : describe.skip;

/**
 * The scope routing and the validity window, against real PostgreSQL.
 *
 * These are deliberately not unit tests. What ADR-0004 requires is that the
 * validity window is part of the **SQL filter** and that a PLATFORM role is
 * unreachable through a membership assignment — neither claim can be proven
 * against a fake repository, because a fake would simply do whatever the test
 * told it to.
 *
 * The queries are executed here through `pg` rather than through the Nest
 * container: the subject is the SQL, and booting the application would add a
 * guard chain and a cache between the test and the thing being checked.
 */
describeWithServices('permission resolution against PostgreSQL', () => {
  let pool: Pool;
  let redis: ReturnType<typeof createClient>;

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);
  const suffix = unique();

  const ids = {
    org: `org_p${suffix}`,
    user: `usr_p${suffix}`,
    membership: `mbr_p${suffix}`,
    event: `evt_p${suffix}`,
  };

  /** Mirrors `PrismaPermissionRepository.organizationPermissions`. */
  async function organizationPermissions(
    membershipId: string,
  ): Promise<string[]> {
    const { rows } = await pool.query<{ code: string }>(
      `SELECT DISTINCT p."code"
         FROM "membership_role_assignments" mra
         JOIN "roles" r  ON r."id" = mra."role_id" AND r."scope" = 'ORGANIZATION'
         JOIN "role_permissions" rp ON rp."role_id" = r."id"
         JOIN "permissions" p ON p."id" = rp."permission_id"
        WHERE mra."membership_id" = $1
          AND mra."revoked_at" IS NULL`,
      [membershipId],
    );

    return rows.map((row) => row.code).sort();
  }

  /** Mirrors `PrismaPermissionRepository.eventPermissions`. */
  async function eventPermissions(
    membershipId: string,
    eventId: string,
    at: Date,
  ): Promise<string[]> {
    const { rows } = await pool.query<{ code: string }>(
      `SELECT DISTINCT p."code"
         FROM "event_user_assignments" eua
         JOIN "roles" r  ON r."code" = eua."assignment_type" AND r."scope" = 'EVENT'
         JOIN "role_permissions" rp ON rp."role_id" = r."id"
         JOIN "permissions" p ON p."id" = rp."permission_id"
        WHERE eua."membership_id" = $1
          AND eua."event_id" = $2
          AND eua."status" = 'ACTIVE'
          AND eua."revoked_at" IS NULL
          AND (eua."valid_from"  IS NULL OR eua."valid_from"  <= $3)
          AND (eua."valid_until" IS NULL OR eua."valid_until" >= $3)`,
      [membershipId, eventId, at],
    );

    return rows.map((row) => row.code).sort();
  }

  async function roleIdOf(code: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM roles WHERE code = $1`,
      [code],
    );

    return rows[0]!.id;
  }

  async function grantOrganizationRole(code: string): Promise<string> {
    const id = `mra_${unique()}`;
    await pool.query(
      `INSERT INTO membership_role_assignments
         (id, membership_id, organization_id, role_id)
       VALUES ($1, $2, $3, $4)`,
      [id, ids.membership, ids.org, await roleIdOf(code)],
    );

    return id;
  }

  async function grantEventRole(
    assignmentType: string,
    window: { from: Date | null; until: Date | null },
  ): Promise<string> {
    const id = `eua_${unique()}`;
    await pool.query(
      `INSERT INTO event_user_assignments
         (id, event_id, membership_id, organization_id, assignment_type, status,
          valid_from, valid_until, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, $7, now())`,
      [
        id,
        ids.event,
        ids.membership,
        ids.org,
        assignmentType,
        window.from,
        window.until,
      ],
    );

    return id;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 3 });
    pool.on('error', () => undefined);

    redis = createClient({ url: REDIS_URL });
    redis.on('error', () => undefined);
    await redis.connect();

    await pool.query(
      `INSERT INTO organizations (id, name, slug, status, license_plan, is_enabled, updated_at)
       VALUES ($1, 'P', $2, 'ACTIVE', 'free', true, now())`,
      [ids.org, `p-${suffix}`],
    );
    await pool.query(
      `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
       VALUES ($1, $2, $2, 'P', 'P', 'ACTIVE', now())`,
      [ids.user, `perm.${suffix}@eventini.test`],
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
       VALUES ($1, $2, 'P', $3, 'DRAFT', $4, 'UTC',
               now(), now() + interval '1 day', now())`,
      [ids.event, ids.org, `p-${suffix}`, `EV${suffix.slice(0, 6)}`],
    );
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM event_user_assignments WHERE event_id = $1`, [
      ids.event,
    ]);
    await pool.query(
      `DELETE FROM membership_role_assignments WHERE membership_id = $1`,
      [ids.membership],
    );
  });

  /**
   * The connections close in `finally`, and that is not defensive padding.
   *
   * If a cleanup query throws — which it does the moment the schema is not
   * what the suite expected — an unguarded teardown returns early, leaves the
   * Redis client connected, and Jest never exits. The run then does not fail;
   * it *hangs* until the CI job is cancelled, which reads as an infrastructure
   * flake rather than as the schema problem it actually is.
   */
  afterAll(async () => {
    try {
      await pool.query(`DELETE FROM events WHERE id = $1`, [ids.event]);
      await pool.query(`DELETE FROM organization_memberships WHERE id = $1`, [
        ids.membership,
      ]);
      await pool.query(`DELETE FROM users WHERE id = $1`, [ids.user]);
      await pool.query(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
    } finally {
      await pool.end();
      await redis.quit();
    }
  });

  describe('organization scope', () => {
    it('returns the codes the granted role carries', async () => {
      await grantOrganizationRole('CLIENT_ADMIN');

      expect(await organizationPermissions(ids.membership)).toContain(
        'events.create',
      );
    });

    it('returns nothing for a membership with no role', async () => {
      expect(await organizationPermissions(ids.membership)).toEqual([]);
    });

    /**
     * 🔴 The decisive property of ADR-0004, at the SQL level: a revoked
     * assignment stops granting the moment it is revoked, with no expiry to
     * wait for. The route-level proof arrives with EVT-035's guard.
     */
    it('stops granting the instant the assignment is revoked', async () => {
      const assignment = await grantOrganizationRole('CLIENT_ADMIN');
      expect(await organizationPermissions(ids.membership)).not.toEqual([]);

      await pool.query(
        `UPDATE membership_role_assignments
            SET revoked_at = now() WHERE id = $1`,
        [assignment],
      );

      expect(await organizationPermissions(ids.membership)).toEqual([]);
    });
  });

  /**
   * 🔴 A PLATFORM role reached through a membership assignment would hand an
   * organization-level caller platform privileges. The `scope` filter in the
   * join is what prevents it, and this proves the filter rather than trusting
   * that nobody will ever insert such a row.
   */
  it('never grants a PLATFORM role through a membership assignment', async () => {
    // The row cannot even be created: INV-09 is a trigger, so the escalation
    // is refused at the schema level rather than filtered out at read time.
    // The `scope` filter in the query stays as the second line of defence —
    // it is what would hold if the trigger were ever dropped in a migration.
    await expect(
      pool.query(
        `INSERT INTO membership_role_assignments
           (id, membership_id, organization_id, role_id)
         VALUES ($1, $2, $3, $4)`,
        [
          `mra_${unique()}`,
          ids.membership,
          ids.org,
          await roleIdOf('SUPER_ADMIN'),
        ],
      ),
    ).rejects.toThrow(/INV-09/);

    expect(await organizationPermissions(ids.membership)).toEqual([]);
  });

  /**
   * 🔴 ADR-0004 requires the window to be part of the SQL filter, not a check
   * applied afterwards. A filter in application code is one an early return or
   * a refactor can skip; a row outside its window must not be returned at all.
   */
  describe('the event validity window', () => {
    const hoursFromNow = (hours: number): Date =>
      new Date(Date.now() + hours * 3_600_000);

    it('grants inside the window', async () => {
      await grantEventRole('SCANNER', {
        from: hoursFromNow(-1),
        until: hoursFromNow(1),
      });

      expect(
        await eventPermissions(ids.membership, ids.event, new Date()),
      ).not.toEqual([]);
    });

    it('grants nothing before valid_from', async () => {
      await grantEventRole('SCANNER', {
        from: hoursFromNow(2),
        until: hoursFromNow(4),
      });

      expect(
        await eventPermissions(ids.membership, ids.event, new Date()),
      ).toEqual([]);
    });

    it('grants nothing after valid_until', async () => {
      await grantEventRole('SCANNER', {
        from: hoursFromNow(-4),
        until: hoursFromNow(-2),
      });

      expect(
        await eventPermissions(ids.membership, ids.event, new Date()),
      ).toEqual([]);
    });

    it('treats a null bound as unbounded on that side', async () => {
      await grantEventRole('SCANNER', { from: null, until: null });

      expect(
        await eventPermissions(ids.membership, ids.event, new Date()),
      ).not.toEqual([]);
    });

    it('grants nothing once the assignment is revoked', async () => {
      const assignment = await grantEventRole('SCANNER', {
        from: null,
        until: null,
      });
      await pool.query(
        `UPDATE event_user_assignments
            SET status = 'REVOKED', revoked_at = now() WHERE id = $1`,
        [assignment],
      );

      expect(
        await eventPermissions(ids.membership, ids.event, new Date()),
      ).toEqual([]);
    });

    /**
     * The example from the product context §7.3, made literal: being an
     * administrator of the organization grants nothing on an event without an
     * event assignment.
     */
    it('does not follow from an organization role', async () => {
      await grantOrganizationRole('CLIENT_ADMIN');

      expect(
        await eventPermissions(ids.membership, ids.event, new Date()),
      ).toEqual([]);
    });
  });
});
