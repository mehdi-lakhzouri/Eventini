import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

/**
 * Constraint tests for migration 3 — sprint-03 EVT-015.
 *
 * Raw `pg` rather than Prisma Client, for the same reason as the identity
 * suite: Prisma would reject some of these before they reached PostgreSQL,
 * which proves the client validates and leaves the schema untested. The
 * schema is what has to hold when a script, a migration or a console session
 * bypasses the service layer.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

describeWithDatabase('events schema constraints', () => {
  let pool: Pool;

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);

  // Two organizations, so cross-tenant attempts are expressible.
  const ids = {
    orgA: '',
    orgB: '',
    userA: '',
    userB: '',
    membershipA: '',
    membershipB: '',
    eventA: '',
  };

  const futureStart = '2027-01-01T09:00:00Z';
  const futureEnd = '2027-01-01T18:00:00Z';

  async function insertEvent(
    id: string,
    organizationId: string,
    overrides: {
      startsAt?: string;
      endsAt?: string;
      slug?: string;
      code?: string;
    } = {},
  ): Promise<void> {
    await pool.query(
      `INSERT INTO events
         (id, organization_id, name, slug, status, event_code, timezone, starts_at, ends_at, updated_at)
       VALUES ($1, $2, 'Event', $3, 'DRAFT', $4, 'Africa/Tunis', $5, $6, now())`,
      [
        id,
        organizationId,
        overrides.slug ?? `slug-${unique()}`,
        overrides.code ?? unique().slice(0, 8).toUpperCase(),
        overrides.startsAt ?? futureStart,
        overrides.endsAt ?? futureEnd,
      ],
    );
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    pool.on('error', () => undefined);

    const suffix = unique();
    Object.assign(ids, {
      orgA: `org_a${suffix}`,
      orgB: `org_b${suffix}`,
      userA: `usr_a${suffix}`,
      userB: `usr_b${suffix}`,
      membershipA: `mbr_a${suffix}`,
      membershipB: `mbr_b${suffix}`,
      eventA: `evt_a${suffix}`,
    });

    await pool.query(
      `INSERT INTO organizations (id, name, slug, status, license_plan, updated_at)
       VALUES ($1, 'A', $2, 'ACTIVE', 'free', now()), ($3, 'B', $4, 'ACTIVE', 'free', now())`,
      [ids.orgA, `a-${suffix}`, ids.orgB, `b-${suffix}`],
    );
    await pool.query(
      `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
       VALUES ($1, $2, $2, 'A', 'A', 'ACTIVE', now()), ($3, $4, $4, 'B', 'B', 'ACTIVE', now())`,
      [
        ids.userA,
        `a${suffix}@example.com`,
        ids.userB,
        `b${suffix}@example.com`,
      ],
    );
    await pool.query(
      `INSERT INTO organization_memberships (id, user_id, organization_id, status, updated_at)
       VALUES ($1, $2, $3, 'ACTIVE', now()), ($4, $5, $6, 'ACTIVE', now())`,
      [
        ids.membershipA,
        ids.userA,
        ids.orgA,
        ids.membershipB,
        ids.userB,
        ids.orgB,
      ],
    );
    await insertEvent(ids.eventA, ids.orgA);
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM event_user_assignments WHERE organization_id = ANY($1)`,
      [[ids.orgA, ids.orgB]],
    );
    await pool.query(
      `DELETE FROM event_sessions WHERE organization_id = ANY($1)`,
      [[ids.orgA, ids.orgB]],
    );
    await pool.query(`DELETE FROM events WHERE organization_id = ANY($1)`, [
      [ids.orgA, ids.orgB],
    ]);
    await pool.query(
      `DELETE FROM organization_memberships WHERE id = ANY($1)`,
      [[ids.membershipA, ids.membershipB]],
    );
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [
      [ids.userA, ids.userB],
    ]);
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1)`, [
      [ids.orgA, ids.orgB],
    ]);
    await pool.end();
  });

  describe('CHECK constraints (§2.2, §6.1)', () => {
    it('rejects an event status outside the allowed set', async () => {
      await expect(
        pool.query(
          `INSERT INTO events (id, organization_id, name, slug, status, event_code, timezone, starts_at, ends_at, updated_at)
           VALUES ($1, $2, 'X', $3, 'PUBLISHED', $4, 'UTC', $5, $6, now())`,
          [
            `evt_${unique()}`,
            ids.orgA,
            `s-${unique()}`,
            unique().slice(0, 8).toUpperCase(),
            futureStart,
            futureEnd,
          ],
        ),
      ).rejects.toThrow(/ck_events_status/);
    });

    /**
     * Not a validation nicety: every check-in window, report period and
     * expiry sweep derives from this ordering, so a reversed pair is a
     * corrupt row rather than a bad input.
     */
    it('rejects an event that ends before it starts', async () => {
      await expect(
        insertEvent(`evt_${unique()}`, ids.orgA, {
          startsAt: futureEnd,
          endsAt: futureStart,
        }),
      ).rejects.toThrow(/ck_events_date_order/);
    });

    it('rejects a check-in window that closes before it opens', async () => {
      await expect(
        pool.query(
          `INSERT INTO events
             (id, organization_id, name, slug, status, event_code, timezone, starts_at, ends_at,
              check_in_opens_at, check_in_closes_at, updated_at)
           VALUES ($1, $2, 'X', $3, 'DRAFT', $4, 'UTC', $5, $6, $6, $5, now())`,
          [
            `evt_${unique()}`,
            ids.orgA,
            `s-${unique()}`,
            unique().slice(0, 8).toUpperCase(),
            futureStart,
            futureEnd,
          ],
        ),
      ).rejects.toThrow(/ck_events_checkin_window/);
    });

    it('accepts a half-open check-in window, which means "follow the event"', async () => {
      await expect(
        pool.query(
          `INSERT INTO events
             (id, organization_id, name, slug, status, event_code, timezone, starts_at, ends_at,
              check_in_opens_at, updated_at)
           VALUES ($1, $2, 'X', $3, 'DRAFT', $4, 'UTC', $5, $6, $5, now())`,
          [
            `evt_${unique()}`,
            ids.orgA,
            `s-${unique()}`,
            unique().slice(0, 8).toUpperCase(),
            futureStart,
            futureEnd,
          ],
        ),
      ).resolves.toBeDefined();
    });

    it('rejects a session type outside the allowed set', async () => {
      await expect(
        pool.query(
          `INSERT INTO event_sessions
             (id, organization_id, event_id, name, session_type, status, starts_at, ends_at, updated_at)
           VALUES ($1, $2, $3, 'S', 'KEYNOTE', 'SCHEDULED', $4, $5, now())`,
          [`esn_${unique()}`, ids.orgA, ids.eventA, futureStart, futureEnd],
        ),
      ).rejects.toThrow(/ck_event_sessions_type/);
    });

    it('rejects an assignment type that no EVENT-scoped role could match', async () => {
      await expect(
        pool.query(
          `INSERT INTO event_user_assignments
             (id, organization_id, event_id, membership_id, assignment_type, status, updated_at)
           VALUES ($1, $2, $3, $4, 'SUPER_ADMIN', 'ACTIVE', now())`,
          [`eua_${unique()}`, ids.orgA, ids.eventA, ids.membershipA],
        ),
      ).rejects.toThrow(/ck_event_assignments_type/);
    });

    it('rejects a validity window that ends before it begins', async () => {
      await expect(
        pool.query(
          `INSERT INTO event_user_assignments
             (id, organization_id, event_id, membership_id, assignment_type, status,
              valid_from, valid_until, updated_at)
           VALUES ($1, $2, $3, $4, 'SCANNER', 'ACTIVE', $5, $6, now())`,
          [
            `eua_${unique()}`,
            ids.orgA,
            ids.eventA,
            ids.membershipA,
            futureEnd,
            futureStart,
          ],
        ),
      ).rejects.toThrow(/ck_event_assignments_validity_order/);
    });
  });

  describe('partial unique indexes (§6.1)', () => {
    it('scopes the slug to one organization, so two tenants may reuse it', async () => {
      const slug = `shared-${unique()}`;
      await insertEvent(`evt_${unique()}`, ids.orgA, { slug });

      await expect(
        insertEvent(`evt_${unique()}`, ids.orgB, { slug }),
      ).resolves.toBeUndefined();
    });

    it('rejects a duplicate slug inside the same organization', async () => {
      const slug = `dup-${unique()}`;
      await insertEvent(`evt_${unique()}`, ids.orgA, { slug });

      await expect(
        insertEvent(`evt_${unique()}`, ids.orgA, { slug }),
      ).rejects.toThrow(/ux_events_org_slug_active/);
    });

    /**
     * The one identifier that is deliberately global rather than tenant
     * scoped: a scanner types it before any tenant is known, so it is what
     * resolves the tenant.
     */
    it('rejects the same event_code in a DIFFERENT organization', async () => {
      const code = unique().slice(0, 8).toUpperCase();
      await insertEvent(`evt_${unique()}`, ids.orgA, { code });

      await expect(
        insertEvent(`evt_${unique()}`, ids.orgB, { code }),
      ).rejects.toThrow(/ux_events_event_code_active/);
    });

    it('frees the event_code again once the event is soft-deleted', async () => {
      const code = unique().slice(0, 8).toUpperCase();
      const first = `evt_${unique()}`;
      await insertEvent(first, ids.orgA, { code });
      await pool.query(`UPDATE events SET deleted_at = now() WHERE id = $1`, [
        first,
      ]);

      await expect(
        insertEvent(`evt_${unique()}`, ids.orgA, { code }),
      ).resolves.toBeUndefined();
    });
  });

  /**
   * The denormalised `organization_id` is what lets the tenant-isolation
   * extension (EVT-018) check scope without a join. That only holds while the
   * copy is true — so the copy is enforced, not trusted.
   */
  describe('INV-04: event_sessions tenant coherence (§6.2)', () => {
    it('rejects a session whose organization disagrees with its event', async () => {
      await expect(
        pool.query(
          `INSERT INTO event_sessions
             (id, organization_id, event_id, name, session_type, status, starts_at, ends_at, updated_at)
           VALUES ($1, $2, $3, 'S', 'DAY', 'SCHEDULED', $4, $5, now())`,
          [`esn_${unique()}`, ids.orgB, ids.eventA, futureStart, futureEnd],
        ),
      ).rejects.toThrow(/INV-04/);
    });

    it('accepts a session whose organization matches', async () => {
      await expect(
        pool.query(
          `INSERT INTO event_sessions
             (id, organization_id, event_id, name, session_type, status, starts_at, ends_at, updated_at)
           VALUES ($1, $2, $3, 'S', 'DAY', 'SCHEDULED', $4, $5, now())`,
          [`esn_${unique()}`, ids.orgA, ids.eventA, futureStart, futureEnd],
        ),
      ).resolves.toBeDefined();
    });

    it('blocks an UPDATE that moves a session to another tenant', async () => {
      const id = `esn_${unique()}`;
      await pool.query(
        `INSERT INTO event_sessions
           (id, organization_id, event_id, name, session_type, status, starts_at, ends_at, updated_at)
         VALUES ($1, $2, $3, 'S', 'DAY', 'SCHEDULED', $4, $5, now())`,
        [id, ids.orgA, ids.eventA, futureStart, futureEnd],
      );

      await expect(
        pool.query(
          `UPDATE event_sessions SET organization_id = $2 WHERE id = $1`,
          [id, ids.orgB],
        ),
      ).rejects.toThrow(/INV-04/);
    });
  });

  /**
   * Two comparisons, both required. Matching only the event would let another
   * tenant's member be assigned here; matching only the membership would let
   * this tenant's member be assigned to another tenant's event.
   */
  describe('INV-01: assignment tenant coherence (§6.3)', () => {
    it('rejects an assignment whose organization disagrees with the event', async () => {
      await expect(
        pool.query(
          `INSERT INTO event_user_assignments
             (id, organization_id, event_id, membership_id, assignment_type, status, updated_at)
           VALUES ($1, $2, $3, $4, 'SCANNER', 'ACTIVE', now())`,
          [`eua_${unique()}`, ids.orgB, ids.eventA, ids.membershipB],
        ),
      ).rejects.toThrow(/INV-01/);
    });

    it('rejects a membership from another organization on this event', async () => {
      await expect(
        pool.query(
          `INSERT INTO event_user_assignments
             (id, organization_id, event_id, membership_id, assignment_type, status, updated_at)
           VALUES ($1, $2, $3, $4, 'SCANNER', 'ACTIVE', now())`,
          [`eua_${unique()}`, ids.orgA, ids.eventA, ids.membershipB],
        ),
      ).rejects.toThrow(/INV-01/);
    });

    it('accepts an assignment where event, membership and tenant all agree', async () => {
      await expect(
        pool.query(
          `INSERT INTO event_user_assignments
             (id, organization_id, event_id, membership_id, assignment_type, status, updated_at)
           VALUES ($1, $2, $3, $4, 'EVENT_ADMIN', 'ACTIVE', now())`,
          [`eua_${unique()}`, ids.orgA, ids.eventA, ids.membershipA],
        ),
      ).resolves.toBeDefined();
    });

    it('allows re-assigning the same role after the previous grant is revoked', async () => {
      const first = `eua_${unique()}`;
      const second = `eua_${unique()}`;

      await pool.query(
        `INSERT INTO event_user_assignments
           (id, organization_id, event_id, membership_id, assignment_type, status, updated_at)
         VALUES ($1, $2, $3, $4, 'REPORT_VIEWER', 'ACTIVE', now())`,
        [first, ids.orgA, ids.eventA, ids.membershipA],
      );

      await expect(
        pool.query(
          `INSERT INTO event_user_assignments
             (id, organization_id, event_id, membership_id, assignment_type, status, updated_at)
           VALUES ($1, $2, $3, $4, 'REPORT_VIEWER', 'ACTIVE', now())`,
          [second, ids.orgA, ids.eventA, ids.membershipA],
        ),
      ).rejects.toThrow(/ux_event_assignment_active/);

      await pool.query(
        `UPDATE event_user_assignments SET revoked_at = now() WHERE id = $1`,
        [first],
      );

      await expect(
        pool.query(
          `INSERT INTO event_user_assignments
             (id, organization_id, event_id, membership_id, assignment_type, status, updated_at)
           VALUES ($1, $2, $3, $4, 'REPORT_VIEWER', 'ACTIVE', now())`,
          [second, ids.orgA, ids.eventA, ids.membershipA],
        ),
      ).resolves.toBeDefined();
    });
  });
});
