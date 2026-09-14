import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

/**
 * Constraint tests for migration 9 — sprint-10 EVT-054.
 *
 * Raw `pg` rather than Prisma Client, like the other schema suites: what has
 * to hold is the schema itself, including for an import script or a console
 * session that never goes through the repository.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

describeWithDatabase('participants schema constraints', () => {
  let pool: Pool;

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = { orgA: '', orgB: '' };

  async function insertParticipant(
    organizationId: string,
    overrides: {
      id?: string;
      normalizedEmail?: string | null;
      participantType?: string;
      deletedAt?: string | null;
    } = {},
  ): Promise<string> {
    const id = overrides.id ?? `par_${unique()}`;
    const email =
      overrides.normalizedEmail === undefined
        ? `${unique()}@example.com`
        : overrides.normalizedEmail;

    await pool.query(
      `INSERT INTO participants
         (id, organization_id, first_name, last_name, email, normalized_email,
          participant_type, dedup_fingerprint, deleted_at, updated_at)
       VALUES ($1, $2, 'Ada', 'Lovelace', $3, $3, $4, 'fp', $5, now())`,
      [
        id,
        organizationId,
        email,
        overrides.participantType ?? 'STANDARD',
        overrides.deletedAt ?? null,
      ],
    );

    return id;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    pool.on('error', () => undefined);

    const suffix = unique();
    ids.orgA = `org_pa${suffix}`;
    ids.orgB = `org_pb${suffix}`;

    await pool.query(
      `INSERT INTO organizations (id, name, slug, status, license_plan, updated_at)
       VALUES ($1, 'A', $2, 'ACTIVE', 'free', now()), ($3, 'B', $4, 'ACTIVE', 'free', now())`,
      [ids.orgA, `pa-${suffix}`, ids.orgB, `pb-${suffix}`],
    );
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM participants WHERE organization_id = ANY($1)`,
      [[ids.orgA, ids.orgB]],
    );
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1)`, [
      [ids.orgA, ids.orgB],
    ]);
    await pool.end();
  });

  describe('ux_participants_org_email_active (§7.1)', () => {
    it('rejects a second active participant with the same email in one organization', async () => {
      const email = `dup-${unique()}@example.com`;
      await insertParticipant(ids.orgA, { normalizedEmail: email });

      await expect(
        insertParticipant(ids.orgA, { normalizedEmail: email }),
      ).rejects.toThrow(/ux_participants_org_email_active/);
    });

    /**
     * The isolation requirement, not a convenience: a global unique index
     * would let one client learn, by a refused insert, that a given person
     * is a participant of another client.
     */
    it('accepts the same email in two organizations', async () => {
      const email = `shared-${unique()}@example.com`;
      await insertParticipant(ids.orgA, { normalizedEmail: email });

      await expect(
        insertParticipant(ids.orgB, { normalizedEmail: email }),
      ).resolves.toMatch(/^par_/);
    });

    it('accepts any number of participants without an email', async () => {
      await insertParticipant(ids.orgA, { normalizedEmail: null });

      await expect(
        insertParticipant(ids.orgA, { normalizedEmail: null }),
      ).resolves.toMatch(/^par_/);
    });

    it('releases the email of a soft-deleted participant', async () => {
      const email = `reused-${unique()}@example.com`;
      await insertParticipant(ids.orgA, {
        normalizedEmail: email,
        deletedAt: new Date().toISOString(),
      });

      await expect(
        insertParticipant(ids.orgA, { normalizedEmail: email }),
      ).resolves.toMatch(/^par_/);
    });

    it('is a partial unique index on exactly those predicates', async () => {
      const { rows } = await pool.query<{ definition: string }>(
        `SELECT pg_get_indexdef(indexrelid) AS definition
           FROM pg_index
          WHERE indexrelid = 'ux_participants_org_email_active'::regclass`,
      );

      expect(rows[0]?.definition).toMatch(
        /UNIQUE INDEX .* \(organization_id, normalized_email\) WHERE \(\(normalized_email IS NOT NULL\) AND \(deleted_at IS NULL\)\)/,
      );
    });
  });

  describe('CHECK constraints (§2.2, §7.1)', () => {
    it('rejects a participant type outside the allowed set', async () => {
      await expect(
        insertParticipant(ids.orgA, { participantType: 'GUEST' }),
      ).rejects.toThrow(/ck_participants_type/);
    });
  });

  describe('foreign keys', () => {
    it('rejects a participant of an organization that does not exist', async () => {
      await expect(insertParticipant(`org_missing${unique()}`)).rejects.toThrow(
        /participants_organization_id_fkey/,
      );
    });
  });

  describe('indexes (§7.1)', () => {
    it.each([
      'ix_participants_org_dedup',
      'ix_participants_org_type',
      'ix_participants_org_created',
      'ix_participants_org_lastname',
    ])('declares %s', async (name) => {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_indexes
          WHERE tablename = 'participants' AND indexname = $1`,
        [name],
      );

      expect(rows[0]?.count).toBe('1');
    });
  });
});
