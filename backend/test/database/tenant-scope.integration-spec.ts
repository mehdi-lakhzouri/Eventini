import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { PrismaClient } from '../../src/infrastructure/database/prisma/generated/client';
import { TenantScopeViolationError } from '../../src/infrastructure/database/tenant-scope.error';
import {
  withTenantScope,
  type TenantScopedPrismaClient,
} from '../../src/infrastructure/database/tenant-scope.extension';

/**
 * The tenant guard against real PostgreSQL — sprint-03 EVT-018, ADR-0003.
 *
 * The unit spec proves the guard refuses; refusing is easy. What needs a
 * database is the other half: that a *scoped* query still works, returns only
 * its own tenant's rows, and keeps being guarded inside a transaction — the
 * property `TransactionManager` now depends on, and the one where a wrong
 * assumption would leave multi-step writes unguarded while single queries
 * looked fine.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

describeWithDatabase('tenant scope against PostgreSQL', () => {
  let prisma: TenantScopedPrismaClient;
  let base: PrismaClient;
  let pool: Pool;

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);
  const suffix = unique();

  const ids = {
    orgA: `org_a${suffix}`,
    orgB: `org_b${suffix}`,
    userA: `usr_a${suffix}`,
    membershipA: `mbr_a${suffix}`,
    eventA: `evt_a${suffix}`,
    eventB: `evt_b${suffix}`,
    sessionA: `esn_a${suffix}`,
  };

  beforeAll(async () => {
    base = new PrismaClient({
      adapter: new PrismaPg({ connectionString: DATABASE_URL, max: 2 }),
    });
    prisma = withTenantScope(base);
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    pool.on('error', () => undefined);

    // Fixtures go in through raw SQL: the guard is what is under test, so
    // building its inputs with it would be circular.
    await pool.query(
      `INSERT INTO organizations (id, name, slug, status, license_plan, updated_at)
       VALUES ($1, 'A', $2, 'ACTIVE', 'free', now()), ($3, 'B', $4, 'ACTIVE', 'free', now())`,
      [ids.orgA, `a-${suffix}`, ids.orgB, `b-${suffix}`],
    );
    await pool.query(
      `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
       VALUES ($1, $2, $2, 'A', 'A', 'ACTIVE', now())`,
      [ids.userA, `a${suffix}@example.com`],
    );
    await pool.query(
      `INSERT INTO organization_memberships (id, user_id, organization_id, status, updated_at)
       VALUES ($1, $2, $3, 'ACTIVE', now())`,
      [ids.membershipA, ids.userA, ids.orgA],
    );

    for (const [id, organizationId] of [
      [ids.eventA, ids.orgA],
      [ids.eventB, ids.orgB],
    ]) {
      await pool.query(
        `INSERT INTO events
           (id, organization_id, name, slug, status, event_code, timezone,
            starts_at, ends_at, updated_at)
         VALUES ($1, $2, 'Event', $3, 'DRAFT', $4, 'Africa/Tunis',
                 '2027-01-01T09:00:00Z', '2027-01-01T18:00:00Z', now())`,
        [id, organizationId, `slug-${unique()}`, unique().slice(0, 8)],
      );
    }

    await pool.query(
      `INSERT INTO event_sessions
         (id, organization_id, event_id, name, session_type, status,
          starts_at, ends_at, updated_at)
       VALUES ($1, $2, $3, 'Keynote', 'PANEL', 'SCHEDULED',
               '2027-01-01T10:00:00Z', '2027-01-01T11:00:00Z', now())`,
      [ids.sessionA, ids.orgA, ids.eventA],
    );
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM event_sessions WHERE organization_id = ANY($1)`,
      [[ids.orgA, ids.orgB]],
    );
    await pool.query(
      `DELETE FROM membership_role_assignments WHERE membership_id = $1`,
      [ids.membershipA],
    );
    await pool.query(`DELETE FROM events WHERE organization_id = ANY($1)`, [
      [ids.orgA, ids.orgB],
    ]);
    await pool.query(`DELETE FROM organization_memberships WHERE id = $1`, [
      ids.membershipA,
    ]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [ids.userA]);
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1)`, [
      [ids.orgA, ids.orgB],
    ]);

    await base.$disconnect();
    await pool.end();
  });

  describe('a scoped query works and stays inside its tenant', () => {
    it('returns the tenant’s own rows', async () => {
      const events = await prisma.event.findMany({
        where: { organizationId: ids.orgA },
      });

      expect(events.map((event) => event.id)).toEqual([ids.eventA]);
    });

    /**
     * The actual point of the whole ticket. Organization B's event exists and
     * is reachable by id, and a query scoped to A must not find it.
     */
    it('cannot reach another tenant’s row by id', async () => {
      const found = await prisma.event.findFirst({
        where: { id: ids.eventB, organizationId: ids.orgA },
      });

      expect(found).toBeNull();
    });

    /**
     * `findUnique` with a non-unique field alongside the unique one —
     * Prisma's extended `where`. This is the shape repositories will use, so
     * it has to work against the real client rather than merely typecheck.
     */
    it('supports a scoped findUnique', async () => {
      const found = await prisma.event.findUnique({
        where: { id: ids.eventA, organizationId: ids.orgA },
      });

      expect(found?.id).toBe(ids.eventA);

      const crossTenant = await prisma.event.findUnique({
        where: { id: ids.eventB, organizationId: ids.orgA },
      });

      expect(crossTenant).toBeNull();
    });

    it('supports a scoped count and aggregate', async () => {
      await expect(
        prisma.event.count({ where: { organizationId: ids.orgA } }),
      ).resolves.toBe(1);

      const aggregate = await prisma.event.aggregate({
        where: { organizationId: ids.orgA },
        _count: true,
      });

      expect(aggregate._count).toBe(1);
    });

    it('guards EVENT-owned models on the denormalised column', async () => {
      const sessions = await prisma.eventSession.findMany({
        where: { organizationId: ids.orgA, eventId: ids.eventA },
      });

      expect(sessions.map((session) => session.id)).toEqual([ids.sessionA]);
    });
  });

  describe('refuses the unscoped equivalents', () => {
    it('refuses findMany with no organization', async () => {
      await expect(prisma.event.findMany()).rejects.toThrow(
        TenantScopeViolationError,
      );
    });

    it('refuses findUnique by id alone', async () => {
      await expect(
        prisma.event.findUnique({ where: { id: ids.eventB } }),
      ).rejects.toThrow(TenantScopeViolationError);
    });
  });

  /**
   * 🔴 The property `TransactionManager` rests on.
   *
   * `$transaction` derives its client from the one it was called on. Starting
   * a transaction from the unguarded service would hand every use case an
   * unguarded `tx` — so the guard would hold for single queries and silently
   * stop holding for exactly the multi-step writes that touch the most tenant
   * data. This proves it holds inside, both ways.
   */
  describe('inside an interactive transaction', () => {
    it('still refuses an unscoped query', async () => {
      await expect(
        prisma.$transaction(async (tx) => tx.event.findMany()),
      ).rejects.toThrow(TenantScopeViolationError);
    });

    it('still allows a scoped one', async () => {
      const events = await prisma.$transaction(async (tx) =>
        tx.event.findMany({ where: { organizationId: ids.orgA } }),
      );

      expect(events.map((event) => event.id)).toEqual([ids.eventA]);
    });

    it('rolls the transaction back when the guard throws', async () => {
      const before = await prisma.event.count({
        where: { organizationId: ids.orgA },
      });

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.event.update({
            where: { id: ids.eventA, organizationId: ids.orgA },
            data: { name: 'Renamed' },
          });

          // Unscoped, so the guard throws and the rename above must not stick.
          return tx.event.findMany();
        }),
      ).rejects.toThrow(TenantScopeViolationError);

      const after = await prisma.event.findMany({
        where: { organizationId: ids.orgA },
      });

      expect(after).toHaveLength(before);
      expect(after[0]?.name).toBe('Event');
    });
  });

  /**
   * EVT-021's migration 4 gave `membership_role_assignments` the
   * `organization_id` column ADR-0003 §1 always required, so it is guarded on
   * the plain column like every other tenant table and EVT-018's relation
   * workaround is gone.
   */
  describe('the role-grant table', () => {
    const assignmentId = `asg_${unique()}`;

    it('accepts a scoped create', async () => {
      const role = await prisma.role.findUniqueOrThrow({
        where: { code: 'CLIENT_ADMIN' },
      });

      await prisma.membershipRoleAssignment.create({
        data: {
          id: assignmentId,
          organizationId: ids.orgA,
          membershipId: ids.membershipA,
          roleId: role.id,
        },
      });

      expect(
        await prisma.membershipRoleAssignment.count({
          where: { organizationId: ids.orgA },
        }),
      ).toBe(1);
    });

    it('returns nothing for the other tenant', async () => {
      expect(
        await prisma.membershipRoleAssignment.count({
          where: { organizationId: ids.orgB },
        }),
      ).toBe(0);
    });

    it('refuses an unscoped query', async () => {
      await expect(prisma.membershipRoleAssignment.findMany()).rejects.toThrow(
        TenantScopeViolationError,
      );
    });
  });

  describe('$unscoped', () => {
    it('lets a genuine platform query run', async () => {
      const events = await prisma.$unscoped('platform inventory', () =>
        prisma.event.findMany({
          where: { id: { in: [ids.eventA, ids.eventB] } },
        }),
      );

      expect(events.map((event) => event.id).sort()).toEqual(
        [ids.eventA, ids.eventB].sort(),
      );
    });

    it('covers queries issued inside a transaction it opened', async () => {
      const events = await prisma.$unscoped('platform inventory', () =>
        prisma.$transaction(async (tx) =>
          tx.event.findMany({
            where: { id: { in: [ids.eventA, ids.eventB] } },
          }),
        ),
      );

      expect(events).toHaveLength(2);
    });

    it('stops covering anything once it has returned', async () => {
      await prisma.$unscoped('platform inventory', () =>
        prisma.event.findMany({ where: { id: ids.eventA } }),
      );

      await expect(prisma.event.findMany()).rejects.toThrow(
        TenantScopeViolationError,
      );
    });
  });

  /**
   * The documented hole, asserted rather than described. Raw SQL never
   * reaches `$allModels`, so the guard cannot see it — which is why the
   * security workflow flags `$queryRaw` for review and why ADR-0003 says the
   * guarantee is applicative. A test that fails here would mean the hole had
   * closed, which is worth knowing too.
   */
  it('does not see raw SQL', async () => {
    const rows = await prisma.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) AS count FROM events WHERE organization_id = ${ids.orgB}`;

    expect(Number(rows[0]?.count)).toBe(1);
  });
});
