import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

/**
 * Constraint tests for migration 8 — sprint-03 EVT-016.
 *
 * The append-only rule can only be verified by asking PostgreSQL: an audit
 * trail the application merely promises not to rewrite is not evidence of
 * anything, and the first person to want it rewritten is whoever it
 * incriminates.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

describeWithDatabase('audit and security schema constraints', () => {
  let pool: Pool;

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);
  const createdSecurityEvents: string[] = [];
  const createdAuditLogs: string[] = [];

  async function insertSecurityEvent(
    overrides: {
      eventType?: string;
      severity?: string;
      result?: string;
      occurredAt?: string;
    } = {},
  ): Promise<string> {
    const id = `sec_${unique()}`;
    await pool.query(
      `INSERT INTO security_events (id, event_type, severity, result, occurred_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        id,
        overrides.eventType ?? 'LOGIN_FAILED',
        overrides.severity ?? 'MEDIUM',
        overrides.result ?? 'FAILURE',
        overrides.occurredAt ?? new Date().toISOString(),
      ],
    );
    createdSecurityEvents.push(id);
    return id;
  }

  async function insertAuditLog(): Promise<string> {
    const id = `aud_${unique()}`;
    await pool.query(
      `INSERT INTO audit_logs (id, target_type, target_id, action, actor_role)
       VALUES ($1, 'user', $2, 'user.created', 'CLIENT_ADMIN')`,
      [id, `usr_${unique()}`],
    );
    createdAuditLogs.push(id);
    return id;
  }

  /** Deletion needs the retention escape, which is the point of these tests. */
  async function purge(table: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL eventini.retention_purge = 'on'");
      await client.query(`DELETE FROM ${table} WHERE id = ANY($1)`, [ids]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  }

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    pool.on('error', () => undefined);
  });

  afterAll(async () => {
    await purge('security_events', createdSecurityEvents);
    await purge('audit_logs', createdAuditLogs);
    await pool.end();
  });

  describe('CHECK constraints (§8.1)', () => {
    it('rejects an event type outside the C-11 union', async () => {
      await expect(
        insertSecurityEvent({ eventType: 'NOT_A_REAL_EVENT' }),
      ).rejects.toThrow(/ck_security_events_type/);
    });

    it('rejects a severity outside the allowed set', async () => {
      await expect(
        insertSecurityEvent({ severity: 'CATASTROPHIC' }),
      ).rejects.toThrow(/ck_security_events_severity/);
    });

    it('rejects a result outside the allowed set', async () => {
      await expect(insertSecurityEvent({ result: 'MAYBE' })).rejects.toThrow(
        /ck_security_events_result/,
      );
    });

    /**
     * DENIED is not a synonym for FAILURE: a failure is an attempt that did
     * not work, a denial is one refused by policy.
     */
    it.each(['SUCCESS', 'FAILURE', 'DENIED'])(
      'accepts result %s',
      async (result) => {
        await expect(insertSecurityEvent({ result })).resolves.toMatch(/^sec_/);
      },
    );

    it.each([
      'ROLE_ESCALATION_ATTEMPTED',
      'ORGANIZATION_KILL_SWITCH_EXECUTED',
      'UNSCOPED_QUERY_EXECUTED',
      'SIGNING_KEY_ROTATED',
      'TICKET_REPLAY_DETECTED',
    ])('accepts %s, one of the codes C-11 added', async (eventType) => {
      await expect(insertSecurityEvent({ eventType })).resolves.toMatch(
        /^sec_/,
      );
    });
  });

  /**
   * The rule the ticket states as "no UPDATE, no DELETE from the
   * application". Enforced by trigger rather than convention, so a stray
   * ORM call, a migration or a console session all fail identically.
   */
  describe('APPEND_ONLY (§2.5)', () => {
    it('refuses to update a security event', async () => {
      const id = await insertSecurityEvent();

      await expect(
        pool.query(
          `UPDATE security_events SET severity = 'INFO' WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/APPEND_ONLY/);
    });

    it('refuses to delete a security event outside a retention purge', async () => {
      const id = await insertSecurityEvent();

      await expect(
        pool.query(`DELETE FROM security_events WHERE id = $1`, [id]),
      ).rejects.toThrow(/APPEND_ONLY/);
    });

    it('refuses to update an audit log', async () => {
      const id = await insertAuditLog();

      await expect(
        pool.query(`UPDATE audit_logs SET action = 'tampered' WHERE id = $1`, [
          id,
        ]),
      ).rejects.toThrow(/APPEND_ONLY/);
    });

    it('refuses to delete an audit log outside a retention purge', async () => {
      const id = await insertAuditLog();

      await expect(
        pool.query(`DELETE FROM audit_logs WHERE id = $1`, [id]),
      ).rejects.toThrow(/APPEND_ONLY/);
    });

    it('refuses even to null out a single column, which is the subtle way to tamper', async () => {
      const id = await insertAuditLog();

      await expect(
        pool.query(`UPDATE audit_logs SET actor_role = NULL WHERE id = $1`, [
          id,
        ]),
      ).rejects.toThrow(/APPEND_ONLY/);
    });

    /**
     * security_events is retained for 12 months (§8.1), so deletion has to be
     * possible for the purge and impossible for everything else.
     */
    it('allows deletion inside a transaction that declares a retention purge', async () => {
      const id = await insertSecurityEvent();
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL eventini.retention_purge = 'on'");
        const deleted = await client.query(
          `DELETE FROM security_events WHERE id = $1`,
          [id],
        );
        await client.query('COMMIT');

        expect(deleted.rowCount).toBe(1);
      } finally {
        client.release();
      }
    });

    /**
     * `SET LOCAL` cannot outlive its transaction. That is what makes the
     * escape safe: it cannot be left switched on for a later, unrelated
     * statement on the same pooled connection.
     */
    it('does not let the purge flag leak past its transaction', async () => {
      const id = await insertSecurityEvent();
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL eventini.retention_purge = 'on'");
        await client.query('COMMIT');

        // Same connection, new transaction: the flag is gone.
        await expect(
          client.query(`DELETE FROM security_events WHERE id = $1`, [id]),
        ).rejects.toThrow(/APPEND_ONLY/);
      } finally {
        client.release();
      }
    });

    it('still permits inserts, which is the whole point of append-only', async () => {
      await expect(insertSecurityEvent()).resolves.toMatch(/^sec_/);
    });
  });

  describe('audit_logs shape (§8.2)', () => {
    /**
     * A textual snapshot rather than a foreign key: a FK would rewrite the
     * audit trail whenever a role is renamed or deleted, so the record of
     * what someone was permitted to do would change after the fact.
     */
    it('keeps actor_role as free text, not a foreign key to roles', async () => {
      const id = `aud_${unique()}`;
      await pool.query(
        `INSERT INTO audit_logs (id, target_type, action, actor_role)
         VALUES ($1, 'organization', 'organization.suspended', 'A_ROLE_THAT_NO_LONGER_EXISTS')`,
        [id],
      );
      createdAuditLogs.push(id);

      const { rows } = await pool.query<{ actor_role: string }>(
        `SELECT actor_role FROM audit_logs WHERE id = $1`,
        [id],
      );
      expect(rows[0]?.actor_role).toBe('A_ROLE_THAT_NO_LONGER_EXISTS');
    });

    it('stores previous and new values as JSONB', async () => {
      const id = `aud_${unique()}`;
      await pool.query(
        `INSERT INTO audit_logs (id, target_type, action, previous_values, new_values)
         VALUES ($1, 'user', 'user.password_changed', $2, $3)`,
        [
          id,
          JSON.stringify({ passwordHash: '[REDACTED]' }),
          JSON.stringify({ passwordHash: '[REDACTED]' }),
        ],
      );
      createdAuditLogs.push(id);

      const { rows } = await pool.query<{
        previous_values: Record<string, unknown>;
        new_values: Record<string, unknown>;
      }>(`SELECT previous_values, new_values FROM audit_logs WHERE id = $1`, [
        id,
      ]);

      // Both sides carry the key, which is what records that it changed.
      expect(rows[0]?.previous_values).toHaveProperty('passwordHash');
      expect(rows[0]?.new_values).toHaveProperty('passwordHash');
    });
  });
});
