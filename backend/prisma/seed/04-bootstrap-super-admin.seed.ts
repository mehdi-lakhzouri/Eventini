import {
  ID_PREFIXES,
  newId,
} from '../../src/infrastructure/database/identifiers';
import { normalizeEmail } from '../../src/infrastructure/database/normalize-email';
import type { TransactionalClient } from '../../src/infrastructure/database/transaction.manager';

import { outcome, type SeedOutcome } from './seed-outcome';

/**
 * Seed step 4 — the bootstrap platform administrator (EVT-017).
 *
 * ## 🔴 No password is ever written by a seed
 *
 * The ticket states this without qualification, including for development,
 * and gives the reason in one sentence: a seed password ends up in production
 * every single time. It is committed, so it is in the git history of every
 * clone; it is identical across environments, so it is the first thing tried
 * against staging; and it is created before anyone is watching, so nothing
 * flags its first use.
 *
 * This step therefore creates the account and stops. No `user_credentials`
 * row is written at all — not a placeholder, not a hash of a known string,
 * not a random value printed to the console. The account exists, is `PENDING`,
 * and cannot authenticate.
 *
 * ## The bootstrap problem is real, and this is only most of the answer
 *
 * INV-10 requires an active `SUPER_ADMIN` to always exist and INV-11 requires
 * it to have MFA enabled. A virgin database satisfies neither, and neither can
 * be satisfied by a seed without writing a credential. The documented
 * procedure closes the gap by handing the last steps to a human:
 *
 * ```
 * 1  read BOOTSTRAP_SUPER_ADMIN_EMAIL                          ← here
 * 2  create the user PENDING, with no credentials              ← here
 * 3  generate a single-use verification token                  ← blocked, see below
 * 4  print it once on standard output                          ← blocked, see below
 * 5  the administrator sets a password and enrols MFA          ← normal flow
 * 6  ACTIVE only after MFA enrolment succeeds                  ← normal flow
 * ```
 *
 * ## Steps 3 and 4 are not implemented, on purpose
 *
 * `email_verification_tokens` does not exist yet: it arrives with migration 4,
 * in EVT-021. There is no table to persist a single-use token in, so a token
 * printed here would be a string nothing could ever verify — worse than
 * printing none, because it looks like a working credential and would be
 * pasted into a browser, fail opaquely, and invite someone to "fix" the
 * bootstrap by writing a password after all.
 *
 * The account is left `PENDING` with no credential, which is the correct and
 * safe resting state, and the operator notice below says exactly what remains
 * to be done. EVT-021 fills in the two missing steps.
 *
 * ## The platform grant is created now rather than later
 *
 * The role assignment does not depend on the token, and creating it here means
 * the account is complete the moment its password is set. It carries status
 * `ACTIVE` because the grant itself is valid — it is the *account* that is
 * `PENDING`, and an account that cannot authenticate cannot use a grant.
 */

const SUPER_ADMIN_ROLE_CODE = 'SUPER_ADMIN';

export interface BootstrapResult {
  readonly seedOutcome: SeedOutcome;
  /** Lines to print for the operator, once, after the run. Never a secret. */
  readonly operatorNotice: readonly string[];
}

export async function bootstrapSuperAdmin(
  tx: TransactionalClient,
): Promise<BootstrapResult> {
  const configured = process.env['BOOTSTRAP_SUPER_ADMIN_EMAIL'];

  if (configured === undefined || configured.trim() === '') {
    // Not an error. Reference data must seed in CI and in any environment
    // whose administrator already exists; refusing to run without this
    // variable would make the seed unusable in both.
    return {
      seedOutcome: outcome('bootstrap_super_admin', {
        notes: [
          'BOOTSTRAP_SUPER_ADMIN_EMAIL is not set, so no platform ' +
            'administrator was created. Set it and re-run on a database that ' +
            'has none.',
        ],
      }),
      operatorNotice: [],
    };
  }

  const normalizedEmail = normalizeEmail(configured);

  const role = await tx.role.findUnique({
    where: { code: SUPER_ADMIN_ROLE_CODE },
    select: { id: true },
  });

  if (role === null) {
    throw new Error(
      `Role ${SUPER_ADMIN_ROLE_CODE} is missing. Step 2 must run before ` +
        `step 4.`,
    );
  }

  const existingUser = await tx.user.findFirst({
    // A soft-deleted row does not count: the partial unique index on
    // `normalized_email` excludes it, so the address is genuinely free.
    where: { normalizedEmail, deletedAt: null },
    select: { id: true, status: true },
  });

  let created = 0;
  let unchanged = 0;
  const notes: string[] = [];
  const operatorNotice: string[] = [];

  let userId: string;

  if (existingUser === null) {
    userId = newId(ID_PREFIXES.user);

    await tx.user.create({
      data: {
        id: userId,
        primaryEmail: configured.trim(),
        normalizedEmail,
        firstName: 'Platform',
        lastName: 'Administrator',
        status: 'PENDING',
        // `createdBy` stays null: there is no actor. This row is the first
        // identity in the system, so attributing it to anyone would be a lie.
      },
    });
    created += 1;

    operatorNotice.push(
      'A platform administrator account was created and CANNOT SIGN IN YET.',
      '',
      `  email   ${configured.trim()}`,
      `  id      ${userId}`,
      '  status  PENDING, with no password and no MFA',
      '',
      'No password was written, deliberately: a seeded password reaches',
      'production every time. Single-use verification tokens require',
      'email_verification_tokens, which arrives with migration 4 (EVT-021);',
      'until then this account has no activation path and is inert, which is',
      'the safe state rather than a broken one.',
    );
  } else {
    userId = existingUser.id;
    unchanged += 1;
    notes.push(
      `A user already exists for the configured bootstrap address ` +
        `(status ${existingUser.status}). Left untouched — the seed never ` +
        `alters an existing account's status or credentials.`,
    );
  }

  const existingGrant = await tx.platformRoleAssignment.findFirst({
    where: { userId, roleId: role.id, status: 'ACTIVE' },
    select: { id: true },
  });

  if (existingGrant === null) {
    await tx.platformRoleAssignment.create({
      data: {
        id: newId(ID_PREFIXES.assignment),
        userId,
        roleId: role.id,
        status: 'ACTIVE',
      },
    });
    created += 1;
  } else {
    unchanged += 1;
  }

  return {
    seedOutcome: outcome('bootstrap_super_admin', {
      created,
      unchanged,
      notes,
    }),
    operatorNotice,
  };
}
