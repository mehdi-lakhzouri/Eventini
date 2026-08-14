import { seedPermissions } from './01-permissions.seed';
import { seedRoles } from './02-roles.seed';
import { seedRolePermissions } from './03-role-permissions.seed';
import { bootstrapSuperAdmin } from './04-bootstrap-super-admin.seed';
import {
  createSeedClient,
  readDatabaseUrl,
  type SeedClient,
} from './seed-client';
import { formatOutcomes, isNoOp, type SeedOutcome } from './seed-outcome';

/**
 * The seed entry point — sprint-03 EVT-017. Run with `npm run db:seed`.
 *
 * ## Why steps 1–3 share one transaction and step 4 does not
 *
 * Steps 1–3 are one logical object: a role catalogue without its permission
 * matrix is not a partial success, it is six roles that grant nothing. If the
 * matrix fails to apply, the roles must not be left behind either, or the next
 * run would find them "already present", skip them, and never repair the
 * grants. One transaction makes that impossible.
 *
 * Step 4 is a different kind of write — it creates an account, not reference
 * data — and it only reads what steps 1–3 committed. Keeping it outside means
 * a failure to bootstrap an administrator does not roll back a correct
 * permission catalogue, which is the half worth keeping.
 *
 * ## Exit code
 *
 * Non-zero on any failure. A seed that fails quietly leaves a database that
 * looks seeded, and the first thing to notice would be an authorization check
 * denying something it should have allowed.
 *
 * ## `--assert-no-op`
 *
 * With this flag the run fails if it changed anything. It exists so the
 * ticket's acceptance test — two runs, identical state — is a check rather
 * than a habit: CI seeds once, then seeds again with the flag. Running the
 * command twice and looking at neither exit code, which is what the step did
 * before, proves only that the script does not crash.
 */

const ASSERT_NO_OP_FLAG = '--assert-no-op';

/**
 * Steps 1–3 write roughly 130 rows and read three tables in full. Prisma's
 * default interactive-transaction timeout is 5 s, which is comfortable
 * locally and not necessarily comfortable against a managed database on a
 * cold connection.
 */
const TRANSACTION_TIMEOUT_MS = 30_000;
const TRANSACTION_MAX_WAIT_MS = 10_000;

async function seedReferenceData(
  prisma: SeedClient,
): Promise<readonly SeedOutcome[]> {
  return prisma.$transaction(
    async (tx) => [
      await seedPermissions(tx),
      await seedRoles(tx),
      await seedRolePermissions(tx),
    ],
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS },
  );
}

function report(outcomes: readonly SeedOutcome[]): void {
  console.log('');
  console.log(formatOutcomes(outcomes));
  console.log('');

  for (const entry of outcomes) {
    for (const note of entry.notes) {
      console.log(`  ${entry.step}: ${note}`);
    }
  }

  if (isNoOp(outcomes)) {
    console.log(
      '  Nothing changed — the database already matches the catalogue.',
    );
  }

  console.log('');
}

async function main(): Promise<void> {
  const prisma = createSeedClient(readDatabaseUrl());

  try {
    const referenceOutcomes = await seedReferenceData(prisma);

    const bootstrap = await prisma.$transaction(
      async (tx) => bootstrapSuperAdmin(tx),
      { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS },
    );

    const outcomes = [...referenceOutcomes, bootstrap.seedOutcome];

    report(outcomes);

    if (bootstrap.operatorNotice.length > 0) {
      const rule = '='.repeat(72);
      console.log(rule);
      for (const line of bootstrap.operatorNotice) {
        console.log(line);
      }
      console.log(rule);
      console.log('');
    }

    if (process.argv.includes(ASSERT_NO_OP_FLAG) && !isNoOp(outcomes)) {
      throw new Error(
        `${ASSERT_NO_OP_FLAG} was requested and this run changed the ` +
          `database. The seed is not idempotent — see the table above for ` +
          `which step wrote.`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
