import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Every enforced invariant has a trigger, checked against the migration SQL —
 * sprint-03 EVT-019.
 *
 * `invariants.integration-spec.ts` proves the triggers *behave*, by asking
 * PostgreSQL. This asks a cheaper and different question, in the unit suite
 * and with no database: does the trigger still **exist**?
 *
 * The two fail on different mistakes, which is why both are here. Deleting a
 * trigger from a migration and rewriting history breaks this one immediately,
 * on every machine, including one with no Docker running — where the
 * integration suite skips itself and the deletion would otherwise sail
 * through review.
 */
const migrationsRoot = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'prisma',
  'migrations',
);

function allMigrationSql(): string {
  return readdirSync(migrationsRoot)
    .filter((entry) => !entry.endsWith('.toml'))
    .map((entry) =>
      readFileSync(join(migrationsRoot, entry, 'migration.sql'), 'utf8'),
    )
    .join('\n');
}

/** Strips SQL comments, so a rule never matches the prose explaining it. */
function statementsOnly(sql: string): string {
  return sql.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*--.*$/gm, '');
}

const sql = statementsOnly(allMigrationSql());

/**
 * The invariants of DATABASE_SCHEMA.md §9 that can be enforced today. The
 * remaining eight constrain tables no migration has created yet, and
 * `invariants.integration-spec.ts` holds the register that fails the day one
 * of those tables appears.
 */
const ENFORCED = [
  { invariant: 'INV-01', trigger: 'trg_event_assignment_tenant' },
  { invariant: 'INV-04', trigger: 'trg_event_session_tenant' },
  { invariant: 'INV-09', trigger: 'trg_membership_role_scope' },
  { invariant: 'INV-09', trigger: 'trg_platform_role_scope' },
  { invariant: 'INV-10', trigger: 'trg_super_admin_floor_update' },
  { invariant: 'INV-10', trigger: 'trg_super_admin_floor_delete' },
] as const;

describe('invariant triggers exist in the migrations', () => {
  it.each(ENFORCED)('$invariant is enforced by $trigger', ({ trigger }) => {
    expect(sql).toContain(`CREATE TRIGGER "${trigger}"`);
  });

  /**
   * The message is the only thing a developer sees when the constraint fires,
   * and it is what the integration tests match on. A trigger that raised
   * without naming its invariant would leave whoever hit it grepping the
   * schema.
   */
  it.each([...new Set(ENFORCED.map((entry) => entry.invariant))])(
    '%s names itself in the exception it raises',
    (invariant) => {
      expect(sql).toMatch(
        new RegExp(`RAISE EXCEPTION[\\s\\S]{0,200}${invariant}`),
      );
    },
  );

  /**
   * A trigger raising `check_violation` is a constraint; one raising the
   * default `raise_exception` is indistinguishable from a bug in a function,
   * both to a human reading a log and to any code that classifies errors.
   */
  it('raises with an SQLSTATE that says "constraint"', () => {
    // Sliced on a fixed window rather than "up to the next semicolon". The
    // first attempt did the latter and failed on the APPEND_ONLY trigger,
    // whose *message* contains a semicolon — "cannot be updated; record a
    // compensating entry instead" — so the match ended before reaching the
    // `USING ERRCODE` clause. The migration was right and the assertion was
    // wrong, which is the more common way round.
    const raises = [...sql.matchAll(/RAISE EXCEPTION/g)].map((match) =>
      sql.slice(match.index, match.index + 400),
    );

    expect(raises.length).toBeGreaterThan(0);
    for (const raise of raises) {
      expect(raise).toMatch(
        /USING ERRCODE = '(check_violation|foreign_key_violation)'/,
      );
    }
  });

  /**
   * INV-10 is the one invariant about a row that must **keep existing**, so
   * it is the only one that has to watch removals rather than writes. A
   * BEFORE INSERT trigger here would enforce nothing at all.
   */
  it('guards INV-10 on the statements that remove a grant', () => {
    expect(sql).toMatch(
      /CREATE TRIGGER "trg_super_admin_floor_update"\s+AFTER UPDATE ON "platform_role_assignments"/,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER "trg_super_admin_floor_delete"\s+AFTER DELETE ON "platform_role_assignments"/,
    );
  });

  /**
   * A row-level trigger would judge a multi-row revocation on a half-updated
   * table. The transition table is also what lets a database with no
   * `SUPER_ADMIN` at all stay writable, which the bootstrap procedure needs.
   */
  it('checks INV-10 per statement, with the pre-image available', () => {
    const superAdminTriggers =
      sql.match(/CREATE TRIGGER "trg_super_admin_floor_\w+"[\s\S]*?;/g) ?? [];

    expect(superAdminTriggers).toHaveLength(2);
    for (const trigger of superAdminTriggers) {
      expect(trigger).toContain('REFERENCING OLD TABLE AS "removed"');
      expect(trigger).toContain('FOR EACH STATEMENT');
    }
  });

  /**
   * INV-01, INV-04 and INV-09 constrain a value that a row already carries,
   * so they must fire on UPDATE as well as INSERT — a trigger that only
   * watched INSERT would leave the violation one statement away.
   */
  it.each([
    'trg_event_assignment_tenant',
    'trg_event_session_tenant',
    'trg_membership_role_scope',
    'trg_platform_role_scope',
  ])('%s fires on UPDATE as well as INSERT', (trigger) => {
    const declaration = new RegExp(
      `CREATE TRIGGER "${trigger}"[\\s\\S]*?;`,
    ).exec(sql)?.[0];

    expect(declaration).toBeDefined();
    expect(declaration).toContain('INSERT OR UPDATE');
  });
});
