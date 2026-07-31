import {
  ID_PREFIXES,
  newId,
} from '../../src/infrastructure/database/identifiers';
import type { TransactionalClient } from '../../src/infrastructure/database/transaction.manager';

import { ROLES } from './authorization-catalogue';
import { outcome, type SeedOutcome } from './seed-outcome';

/**
 * Seed step 2 — the six system roles (EVT-017).
 *
 * Same read-then-write discipline as step 1, for the same reason.
 *
 * ## `isSystem` is forced back to true on every run
 *
 * The ticket states a system role is never editable through an API. That is
 * enforced at the API layer, but the seed also asserts it here: if a row ever
 * appears with `is_system = false` — a manual `UPDATE`, a restored backup
 * taken mid-incident, a future admin endpoint that should not exist — the
 * next seed run puts it back and reports the correction as an update rather
 * than passing over it. A guarantee only checked where it is convenient is
 * not a guarantee.
 *
 * ## Scope drift is a privilege change, so it is treated as one
 *
 * A role's `scope` decides which assignment table can grant it — INV-09 is
 * enforced by trigger for exactly that reason. Changing `SCANNER` from
 * `EVENT` to `ORGANIZATION` would silently widen every scanner operator in
 * the system from one event to the whole tenant. The scope therefore lives in
 * the catalogue, is reconciled here, and cannot be changed anywhere else.
 */
export async function seedRoles(tx: TransactionalClient): Promise<SeedOutcome> {
  const existing = await tx.role.findMany({
    select: {
      id: true,
      code: true,
      name: true,
      scope: true,
      description: true,
      isSystem: true,
    },
  });

  const byCode = new Map(existing.map((row) => [row.code, row]));

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const notes: string[] = [];

  for (const role of ROLES) {
    const current = byCode.get(role.code);

    if (current === undefined) {
      await tx.role.create({
        data: {
          id: newId(ID_PREFIXES.role),
          code: role.code,
          name: role.name,
          scope: role.scope,
          description: role.description,
          isSystem: true,
        },
      });
      created += 1;
      continue;
    }

    if (current.scope !== role.scope) {
      notes.push(
        `Role ${role.code} had scope ${current.scope} in the database and ` +
          `${role.scope} in the catalogue. Restored to the catalogue value — ` +
          `a scope change re-points every grant of this role at a different ` +
          `assignment table (INV-09).`,
      );
    }

    if (!current.isSystem) {
      notes.push(
        `Role ${role.code} had is_system = false in the database. Restored ` +
          `to true: a system role must not be editable through an API.`,
      );
    }

    const drifted =
      current.name !== role.name ||
      current.scope !== role.scope ||
      current.description !== role.description ||
      !current.isSystem;

    if (!drifted) {
      unchanged += 1;
      continue;
    }

    await tx.role.update({
      where: { code: role.code },
      data: {
        name: role.name,
        scope: role.scope,
        description: role.description,
        isSystem: true,
      },
    });
    updated += 1;
  }

  const catalogueCodes = new Set(ROLES.map((entry) => entry.code));
  const orphaned = existing
    .filter((row) => !catalogueCodes.has(row.code))
    .map((row) => row.code)
    .sort();

  if (orphaned.length > 0) {
    // Not deleted, for the same reason permissions are not: roles are
    // referenced by assignment rows and by audit entries. Step 3 strips their
    // permissions, which leaves them holding nothing.
    notes.push(
      `${String(orphaned.length)} role(s) exist in the database but not in ` +
        `the catalogue: ${orphaned.join(', ')}. They are kept and stripped of ` +
        `every permission by step 3.`,
    );
  }

  return outcome('roles', { created, updated, unchanged, notes });
}
