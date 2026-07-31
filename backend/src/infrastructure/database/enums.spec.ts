import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { CHECK_CONSTRAINT_VALUES } from './enums';

const MIGRATIONS_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  'prisma',
  'migrations',
);

function allMigrationSql(): string {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      readFileSync(join(MIGRATIONS_DIR, entry.name, 'migration.sql'), 'utf8'),
    )
    .join('\n');
}

/**
 * The same SQL with `--` comments removed.
 *
 * Needed because the migrations explain themselves: the comment above the
 * CHECK constraints says "TEXT + CHECK rather than CREATE TYPE ... AS ENUM",
 * which a naive search for `CREATE TYPE` matches. The first version of the
 * "no native enum" assertion below failed on exactly that — the prose, not
 * the schema.
 */
function executableSql(): string {
  return allMigrationSql()
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

/**
 * The enum-valued columns are TEXT + CHECK rather than native PostgreSQL
 * enums (DATABASE_SCHEMA.md §2.2), which means the allowed values live in two
 * places: `enums.ts` for the TypeScript side, and the migration SQL for the
 * database. Two sources of truth drift — so this reads the migrations and
 * asserts they agree.
 *
 * Without it, adding a status to `enums.ts` and forgetting the migration
 * compiles cleanly and fails at runtime as a constraint violation, on
 * whichever write first uses the new value.
 */
describe('CHECK constraints match the TypeScript enums', () => {
  const sql = allMigrationSql();

  it.each(Object.keys(CHECK_CONSTRAINT_VALUES))(
    '%s exists in a migration',
    (constraint) => {
      expect(sql).toContain(constraint);
    },
  );

  it.each(Object.entries(CHECK_CONSTRAINT_VALUES))(
    '%s permits exactly the values declared in enums.ts',
    (constraint, values) => {
      // Pull the CHECK body for this constraint out of the SQL.
      const pattern = new RegExp(
        `CONSTRAINT\\s+"${constraint}"\\s+CHECK\\s*\\([^)]*IN\\s*\\(([^)]*)\\)`,
        'i',
      );
      const match = pattern.exec(sql);
      expect(match).not.toBeNull();

      const sqlValues = (match?.[1] ?? '')
        .split(',')
        .map((value) => value.trim().replace(/^'|'$/g, ''))
        .filter((value) => value.length > 0)
        .sort();

      expect(sqlValues).toEqual([...values].sort());
    },
  );

  /**
   * §2.2 forbids `CREATE TYPE ... AS ENUM` outright: a value can be added to
   * a native enum but removing one requires rewriting the table. Prisma
   * generates exactly that from a `enum` block, so this guards against
   * someone reintroducing one and silently reverting the decision.
   */
  it('creates no native PostgreSQL enum type', () => {
    expect(executableSql()).not.toMatch(/CREATE\s+TYPE/i);
  });

  /**
   * §2.2 again: TIMESTAMPTZ everywhere. A bare TIMESTAMP drops the offset,
   * and check-in windows are computed in the event's timezone.
   */
  it('declares every timestamp column as TIMESTAMPTZ', () => {
    // Built inside the callback, without the /g flag. A /g regex reused
    // across `.test()` calls carries `lastIndex` between them and starts the
    // next search mid-string, so it silently skips matches — which the first
    // version of this test did.
    const offenders = executableSql()
      .split('\n')
      .filter((line) => /\bTIMESTAMP\b(?!TZ)/i.test(line));

    expect(offenders).toEqual([]);
  });

  /**
   * §2.5: a plain unique index on a soft-deleted table would let a deleted
   * row reserve its email or slug permanently.
   */
  it.each([
    'ux_users_normalized_email_active',
    'ux_organizations_slug_active',
    'ux_membership_user_org_active',
  ])('%s is a partial index on deleted_at', (indexName) => {
    const pattern = new RegExp(
      `CREATE UNIQUE INDEX "${indexName}"[\\s\\S]*?WHERE "deleted_at" IS NULL`,
    );
    expect(sql).toMatch(pattern);
  });

  it.each(['ux_membership_role_active', 'ux_platform_role_user_active'])(
    '%s is a partial index on revoked_at',
    (indexName) => {
      const pattern = new RegExp(
        `CREATE UNIQUE INDEX "${indexName}"[\\s\\S]*?WHERE "revoked_at" IS NULL`,
      );
      expect(sql).toMatch(pattern);
    },
  );

  /**
   * INV-09 is the most direct privilege-escalation path in the model, so
   * DATABASE_SCHEMA.md §5.6 requires a trigger rather than application code
   * alone.
   */
  it('enforces role scope with database triggers, not only application code', () => {
    expect(sql).toContain('trg_membership_role_scope');
    expect(sql).toContain('trg_platform_role_scope');
    expect(sql).toContain('INV-09');
  });
});
