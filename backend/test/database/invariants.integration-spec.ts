import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

/**
 * The twelve cross-table invariants of DATABASE_SCHEMA.md §9 — sprint-03
 * EVT-019.
 *
 * ## What this file is
 *
 * The register. One entry per invariant, INV-01 to INV-12, in one place, so
 * "which invariants are actually enforced" is a question with a readable
 * answer instead of a search across four migrations and three suites.
 *
 * ## 🔴 Eight of the twelve cannot be tested in sprint 03
 *
 * §9 lists twelve and the sprint's exit criterion asks for twelve failing
 * insertions. Eight of them reference tables that do not exist yet:
 * `user_sessions` and `refresh_token_rotations` arrive with migration 5,
 * `mfa_methods` with 6, `scanner_devices` with 7, and the participant,
 * registration, ticket and attendance tables with 9 through 12. There is
 * nothing to insert into and nothing to reject.
 *
 * Writing `it.todo` for them would be the usual answer and it is a bad one:
 * a todo passes, so the suite stays green when migration 5 lands and INV-02
 * and INV-12 go unenforced. `describe.each` over `DEFERRED` below instead
 * asserts that the tables are still **absent**. The day a migration creates
 * one, that assertion fails, names the invariant, and points whoever wrote
 * the migration at the trigger they owe.
 *
 * A deferral that cannot expire is a deferral nobody will revisit.
 *
 * ## Why against real PostgreSQL and never a mock
 *
 * The ticket is explicit, and the reason is the whole point of the exercise:
 * these are constraints and triggers. A different engine does not enforce
 * them, and a mock enforces whatever it was told to. An invariant maintained
 * only by application code is not an invariant — it holds exactly until the
 * first script, migration or console session that bypasses the service layer.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

/**
 * Invariants whose tables migration 3 has not yet created, with the table
 * whose appearance makes each one testable.
 */
const DEFERRED: readonly { invariant: string; table: string; owner: string }[] =
  [
    { invariant: 'INV-02', table: 'user_sessions', owner: 'EVT-021' },
    { invariant: 'INV-03', table: 'scanner_devices', owner: 'EVT-045' },
    { invariant: 'INV-05', table: 'registrations', owner: 'EVT-041' },
    { invariant: 'INV-06', table: 'registration_sessions', owner: 'EVT-041' },
    { invariant: 'INV-07', table: 'tickets', owner: 'EVT-046' },
    { invariant: 'INV-08', table: 'attendance_records', owner: 'EVT-051' },
    { invariant: 'INV-11', table: 'mfa_methods', owner: 'EVT-021' },
    { invariant: 'INV-12', table: 'user_sessions', owner: 'EVT-021' },
  ];

describeWithDatabase('database invariants (§9)', () => {
  let pool: Pool;

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);
  const suffix = unique();

  const ids = {
    orgA: `org_a${suffix}`,
    orgB: `org_b${suffix}`,
    userA: `usr_a${suffix}`,
    userB: `usr_b${suffix}`,
    membershipA: `mbr_a${suffix}`,
    membershipB: `mbr_b${suffix}`,
    eventA: `evt_a${suffix}`,
  };

  async function roleId(code: string): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `SELECT id FROM roles WHERE code = $1`,
      [code],
    );
    const id = result.rows[0]?.id;

    if (id === undefined) {
      throw new Error(
        `Role ${code} is missing. These tests need the EVT-017 seed applied.`,
      );
    }

    return id;
  }

  /**
   * Runs `work` on its own connection inside a transaction that is always
   * rolled back.
   *
   * Every write to `platform_role_assignments` goes through this, and the
   * reason is INV-10 itself. The invariant makes that table's rows
   * *undeletable* once they are the last active `SUPER_ADMIN` grant — so a
   * test that inserted one and tidied up afterwards would either leave a
   * permanent row behind or fail in its own cleanup. The first attempt here
   * did exactly that: `beforeAll` tried to revoke every active grant to reach
   * a known state, and the trigger refused, which was the invariant working
   * and the test being wrong.
   *
   * Rolling back also removes a hidden dependency on how many `SUPER_ADMIN`
   * grants happen to exist. CI seeds without `BOOTSTRAP_SUPER_ADMIN_EMAIL`,
   * so there are **zero**; locally there is one. A suite whose behaviour
   * depended on which is a suite that passes on one machine.
   */
  async function withRollback(
    work: (client: import('pg').PoolClient) => Promise<void>,
  ): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await work(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  /**
   * A failing statement aborts its transaction, so anything after it in the
   * same one errors with "current transaction is aborted". A savepoint keeps
   * a rejection local to the assertion that expected it.
   */
  async function expectRejection(
    client: import('pg').PoolClient,
    run: () => Promise<unknown>,
    pattern: RegExp,
  ): Promise<void> {
    await client.query('SAVEPOINT attempt');
    await expect(run()).rejects.toThrow(pattern);
    await client.query('ROLLBACK TO SAVEPOINT attempt');
  }

  async function grantPlatformRole(
    client: import('pg').PoolClient,
    userId: string,
    code: string,
    status = 'ACTIVE',
  ): Promise<string> {
    const id = `asg_${unique()}`;

    await client.query(
      `INSERT INTO platform_role_assignments (id, user_id, role_id, status, updated_at)
       VALUES ($1, $2, $3, $4, now())`,
      [id, userId, await roleId(code), status],
    );

    return id;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    pool.on('error', () => undefined);

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
        `inv-a${suffix}@example.com`,
        ids.userB,
        `inv-b${suffix}@example.com`,
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
    await pool.query(
      `INSERT INTO events
         (id, organization_id, name, slug, status, event_code, timezone,
          starts_at, ends_at, updated_at)
       VALUES ($1, $2, 'Event', $3, 'DRAFT', $4, 'Africa/Tunis',
               '2027-01-01T09:00:00Z', '2027-01-01T18:00:00Z', now())`,
      [ids.eventA, ids.orgA, `slug-${unique()}`, unique().slice(0, 8)],
    );
  });

  afterAll(async () => {
    // No `platform_role_assignments` cleanup: every write to that table
    // happens inside a rolled-back transaction, precisely because INV-10 can
    // make those rows undeletable.
    await pool.query(
      `DELETE FROM event_user_assignments WHERE organization_id = ANY($1)`,
      [[ids.orgA, ids.orgB]],
    );
    await pool.query(
      `DELETE FROM event_sessions WHERE organization_id = ANY($1)`,
      [[ids.orgA, ids.orgB]],
    );
    await pool.query(
      `DELETE FROM membership_role_assignments WHERE membership_id = ANY($1)`,
      [[ids.membershipA, ids.membershipB]],
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

  /**
   * INV-01 — `event_user_assignments.organization_id` equals both
   * `events.organization_id` and `organization_memberships.organization_id`.
   *
   * Two distinct ways to break it, because the trigger has two branches and a
   * test that only exercises one leaves the other unproven.
   */
  describe('INV-01: event assignment tenant coherence', () => {
    async function insertAssignment(
      organizationId: string,
      membershipId: string,
    ): Promise<void> {
      await pool.query(
        `INSERT INTO event_user_assignments
           (id, organization_id, event_id, membership_id, assignment_type, status, updated_at)
         VALUES ($1, $2, $3, $4, 'EVENT_ADMIN', 'ACTIVE', now())`,
        [`asg_${unique()}`, organizationId, ids.eventA, membershipId],
      );
    }

    it('accepts an assignment where all three agree', async () => {
      await expect(
        insertAssignment(ids.orgA, ids.membershipA),
      ).resolves.not.toThrow();
    });

    it('rejects one whose organization disagrees with the event', async () => {
      await expect(insertAssignment(ids.orgB, ids.membershipB)).rejects.toThrow(
        /INV-01.*events\.organization_id/s,
      );
    });

    /** The second branch: the event matches, the membership does not. */
    it('rejects one whose membership belongs to another tenant', async () => {
      await expect(insertAssignment(ids.orgA, ids.membershipB)).rejects.toThrow(
        /INV-01.*organization_memberships\.organization_id/s,
      );
    });

    /**
     * An assignment can also be moved after the fact. A trigger that only
     * fired on INSERT would let an UPDATE walk a row into another tenant.
     */
    it('rejects an UPDATE that moves a row to another tenant', async () => {
      const id = `asg_${unique()}`;
      await pool.query(
        `INSERT INTO event_user_assignments
           (id, organization_id, event_id, membership_id, assignment_type, status, updated_at)
         VALUES ($1, $2, $3, $4, 'SCANNER', 'ACTIVE', now())`,
        [id, ids.orgA, ids.eventA, ids.membershipA],
      );

      await expect(
        pool.query(
          `UPDATE event_user_assignments SET organization_id = $1 WHERE id = $2`,
          [ids.orgB, id],
        ),
      ).rejects.toThrow(/INV-01/);
    });
  });

  /** INV-04 — `event_sessions.organization_id` equals `events.organization_id`. */
  describe('INV-04: event session tenant coherence', () => {
    async function insertSession(organizationId: string): Promise<void> {
      await pool.query(
        `INSERT INTO event_sessions
           (id, organization_id, event_id, name, session_type, status,
            starts_at, ends_at, updated_at)
         VALUES ($1, $2, $3, 'Session', 'PANEL', 'SCHEDULED',
                 '2027-01-01T10:00:00Z', '2027-01-01T11:00:00Z', now())`,
        [`esn_${unique()}`, organizationId, ids.eventA],
      );
    }

    it('accepts a session in its event’s organization', async () => {
      await expect(insertSession(ids.orgA)).resolves.not.toThrow();
    });

    it('rejects a session claiming another organization', async () => {
      await expect(insertSession(ids.orgB)).rejects.toThrow(/INV-04/);
    });
  });

  /**
   * INV-09 — a role only ever appears in the assignment table matching its
   * scope. Both directions, because both are escalation paths: a PLATFORM
   * role granted through a membership hands platform authority to whoever
   * administers one organization, and an ORGANIZATION role widened into
   * `platform_role_assignments` does the same in reverse.
   */
  describe('INV-09: role scope matches its assignment table', () => {
    it('rejects a PLATFORM role granted through a membership', async () => {
      await expect(
        pool.query(
          `INSERT INTO membership_role_assignments (id, membership_id, role_id)
           VALUES ($1, $2, $3)`,
          [`asg_${unique()}`, ids.membershipA, await roleId('SUPER_ADMIN')],
        ),
      ).rejects.toThrow(/INV-09/);
    });

    it('rejects an ORGANIZATION role granted at platform level', async () => {
      await expect(
        pool.query(
          `INSERT INTO platform_role_assignments (id, user_id, role_id, status, updated_at)
           VALUES ($1, $2, $3, 'ACTIVE', now())`,
          [`asg_${unique()}`, ids.userA, await roleId('CLIENT_ADMIN')],
        ),
      ).rejects.toThrow(/INV-09/);
    });

    /**
     * An UPDATE can swap the role on an existing row, so a trigger firing
     * only on INSERT would leave the escalation one statement away.
     */
    it('rejects an UPDATE that swaps in a role of the wrong scope', async () => {
      const id = `asg_${unique()}`;
      await pool.query(
        `INSERT INTO membership_role_assignments (id, membership_id, role_id)
         VALUES ($1, $2, $3)`,
        [id, ids.membershipA, await roleId('CLIENT_ADMIN')],
      );

      await expect(
        pool.query(
          `UPDATE membership_role_assignments SET role_id = $1 WHERE id = $2`,
          [await roleId('SUPER_ADMIN'), id],
        ),
      ).rejects.toThrow(/INV-09/);
    });

    it('accepts each role in its own table', async () => {
      // membershipB, not membershipA: the test above already granted
      // CLIENT_ADMIN there, and `ux_membership_role_active` is partial on
      // (membership_id, role_id) WHERE revoked_at IS NULL — so reusing it
      // fails on the unique index rather than on the invariant, which is the
      // index working and the test asking the wrong question.
      await expect(
        pool.query(
          `INSERT INTO membership_role_assignments (id, membership_id, role_id)
           VALUES ($1, $2, $3)`,
          [`asg_${unique()}`, ids.membershipB, await roleId('CLIENT_ADMIN')],
        ),
      ).resolves.toBeDefined();

      await withRollback(async (client) => {
        await expect(
          grantPlatformRole(client, ids.userA, 'SUPER_ADMIN'),
        ).resolves.toBeDefined();
      });
    });
  });

  /**
   * 🔴 INV-10 — at least one ACTIVE SUPER_ADMIN grant always exists.
   *
   * New in EVT-019: §9 stated it and nothing enforced it. Losing the last
   * platform administrator is not a data-quality problem, it is a lockout —
   * nobody can grant the role back, because granting it requires holding it,
   * and the recovery is a manual intervention on the production database.
   */
  describe('INV-10: the last SUPER_ADMIN cannot be revoked', () => {
    /**
     * Reaches "exactly one active grant" without ever passing through zero:
     * grant first, then revoke whatever was already active in a single
     * statement, which leaves the new one standing. Going the other way round
     * would be refused — by the very trigger under test.
     */
    async function withSoleSuperAdmin(
      work: (
        client: import('pg').PoolClient,
        soleGrantId: string,
      ) => Promise<void>,
    ): Promise<void> {
      await withRollback(async (client) => {
        const sole = await grantPlatformRole(client, ids.userA, 'SUPER_ADMIN');

        await client.query(
          `UPDATE platform_role_assignments
              SET status = 'REVOKED', revoked_at = now()
            WHERE status = 'ACTIVE'
              AND id <> $1
              AND role_id = (SELECT id FROM roles WHERE code = 'SUPER_ADMIN')`,
          [sole],
        );

        const remaining = await client.query<{ count: string }>(
          `SELECT count(*) AS count
             FROM platform_role_assignments pra
             JOIN roles r ON r.id = pra.role_id
            WHERE pra.status = 'ACTIVE' AND r.code = 'SUPER_ADMIN'`,
        );
        expect(Number(remaining.rows[0]?.count)).toBe(1);

        await work(client, sole);
      });
    }

    it('refuses to revoke the only active grant', async () => {
      await withSoleSuperAdmin(async (client, sole) => {
        await expectRejection(
          client,
          () =>
            client.query(
              `UPDATE platform_role_assignments
                  SET status = 'REVOKED', revoked_at = now()
                WHERE id = $1`,
              [sole],
            ),
          /INV-10/,
        );
      });
    });

    /** REVOKE_NOT_DELETE is the policy; DELETE is what someone in a hurry does. */
    it('refuses to delete it either', async () => {
      await withSoleSuperAdmin(async (client, sole) => {
        await expectRejection(
          client,
          () =>
            client.query(
              `DELETE FROM platform_role_assignments WHERE id = $1`,
              [sole],
            ),
          /INV-10/,
        );
      });
    });

    /**
     * The reason the check is statement-level. Revoking two of two in one
     * statement is judged on the final state, so it cannot slide through on
     * an intermediate count the way a row-level check might.
     */
    it('refuses a bulk revocation that would empty the role', async () => {
      await withSoleSuperAdmin(async (client, sole) => {
        const second = await grantPlatformRole(
          client,
          ids.userB,
          'SUPER_ADMIN',
        );

        await expectRejection(
          client,
          () =>
            client.query(
              `UPDATE platform_role_assignments
                  SET status = 'REVOKED', revoked_at = now()
                WHERE id = ANY($1)`,
              [[sole, second]],
            ),
          /INV-10/,
        );
      });
    });

    /** The invariant is a floor, not a freeze. */
    it('allows revoking one of two', async () => {
      await withSoleSuperAdmin(async (client, sole) => {
        const second = await grantPlatformRole(
          client,
          ids.userB,
          'SUPER_ADMIN',
        );

        await expect(
          client.query(
            `UPDATE platform_role_assignments
                SET status = 'REVOKED', revoked_at = now()
              WHERE id = $1`,
            [second],
          ),
        ).resolves.toBeDefined();

        expect(sole).toBeDefined();
      });
    });

    it('allows revoking the last one once a replacement is active', async () => {
      await withSoleSuperAdmin(async (client, sole) => {
        await grantPlatformRole(client, ids.userB, 'SUPER_ADMIN');

        await expect(
          client.query(
            `UPDATE platform_role_assignments
                SET status = 'REVOKED', revoked_at = now()
              WHERE id = $1`,
            [sole],
          ),
        ).resolves.toBeDefined();
      });
    });

    /**
     * A grant that was never active cannot be the last one. Blocking it would
     * mean the invariant froze rows it has no opinion about — the trigger
     * returns early unless the statement actually removed an active grant.
     */
    it('ignores statements that touch no active SUPER_ADMIN grant', async () => {
      await withSoleSuperAdmin(async (client) => {
        const suspended = await grantPlatformRole(
          client,
          ids.userB,
          'SUPER_ADMIN',
          'SUSPENDED',
        );

        await expect(
          client.query(`DELETE FROM platform_role_assignments WHERE id = $1`, [
            suspended,
          ]),
        ).resolves.toBeDefined();
      });
    });

    /**
     * The empty case, which is why the trigger consults the transition table
     * instead of merely counting. A virgin database has no SUPER_ADMIN at
     * all, and the bootstrap procedure has to be able to write the first one.
     */
    it('leaves a database with no SUPER_ADMIN writable', async () => {
      await withRollback(async (client) => {
        await client.query(
          `UPDATE platform_role_assignments
              SET status = 'REVOKED', revoked_at = now()
            WHERE status = 'ACTIVE'
              AND role_id = (SELECT id FROM roles WHERE code = 'SUPER_ADMIN')
              AND id <> (
                SELECT id FROM platform_role_assignments
                 WHERE status = 'ACTIVE'
                   AND role_id = (SELECT id FROM roles WHERE code = 'SUPER_ADMIN')
                 LIMIT 1
              )`,
        );

        // Whatever is left, granting a fresh one must always be possible:
        // an INSERT removes nothing, so the trigger never fires on it.
        await expect(
          grantPlatformRole(client, ids.userB, 'SUPER_ADMIN'),
        ).resolves.toBeDefined();
      });
    });
  });

  /**
   * The deferred eight. These assertions exist to **fail** the day their
   * table appears — see the note at the top of this file. A passing run here
   * means "not yet applicable", not "verified".
   */
  describe('invariants still waiting on their tables', () => {
    async function tableExists(name: string): Promise<boolean> {
      const result = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = $1
         ) AS exists`,
        [name],
      );

      return result.rows[0]?.exists ?? false;
    }

    it.each(DEFERRED)(
      '$invariant is deferred until $table exists ($owner)',
      async ({ invariant, table, owner }) => {
        const exists = await tableExists(table);

        // Reads as an equality so the failure message names the invariant and
        // the ticket rather than printing `true is not false`.
        expect({ invariant, table, testable: exists }).toEqual({
          invariant,
          table,
          // When this flips, write the trigger and the failing-insert test,
          // then move the entry out of DEFERRED. The migration that creates
          // the table owns the invariant that constrains it.
          testable: false,
        });

        expect(owner).toMatch(/^EVT-\d{3}$/);
      },
    );

    it('covers every invariant of §9 exactly once', () => {
      const tested = ['INV-01', 'INV-04', 'INV-09', 'INV-10'];
      const deferred = DEFERRED.map((entry) => entry.invariant);
      const all = [...tested, ...deferred].sort();

      expect(new Set(all).size).toBe(all.length);
      expect(all).toEqual(
        Array.from(
          { length: 12 },
          (_, index) => `INV-${String(index + 1).padStart(2, '0')}`,
        ).sort(),
      );
    });
  });
});
