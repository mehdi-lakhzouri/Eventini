import {
  ID_PREFIXES,
  newId,
} from '../../src/infrastructure/database/identifiers';
import type { TransactionalClient } from '../../src/infrastructure/database/transaction.manager';

import { PERMISSIONS } from './authorization-catalogue';
import { outcome, type SeedOutcome } from './seed-outcome';

/**
 * Seed step 1 — the permission catalogue (EVT-017).
 *
 * ## Why this reads before it writes, instead of upserting everything
 *
 * `upsert` is the obvious idempotent primitive and it is the wrong one here.
 * `Permission.updatedAt` carries `@updatedAt`, so an unconditional upsert
 * rewrites the timestamp of all 30 rows on every run — every deploy, every
 * CI job. The rows would be identical in content and different on disk, which
 * costs two things worth keeping: "when did this permission last change"
 * stops being answerable, and the ticket's own test — two runs, identical
 * state — stops being literally true.
 *
 * So the step diffs first and writes only what actually differs. That also
 * makes the second run report `created: 0, updated: 0`, which a CI step can
 * assert on.
 *
 * ## Why nothing is ever deleted
 *
 * The ticket is explicit: a permission removed from the catalogue is not
 * deleted from `permissions`. `audit_logs` rows reference permission codes,
 * and deleting the row would leave an audit entry pointing at nothing —
 * turning "who was allowed to do this, and under what grant" into an
 * unanswerable question precisely when someone is asking it. Removing the
 * permission from `role_permissions` (step 3) already makes it inoperative,
 * which is the effect that was wanted; the row survives as a dictionary entry.
 */
export async function seedPermissions(
  tx: TransactionalClient,
): Promise<SeedOutcome> {
  const existing = await tx.permission.findMany({
    select: {
      id: true,
      code: true,
      resource: true,
      action: true,
      description: true,
    },
  });

  const byCode = new Map(existing.map((row) => [row.code, row]));

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const permission of PERMISSIONS) {
    const current = byCode.get(permission.code);

    if (current === undefined) {
      await tx.permission.create({
        data: {
          id: newId(ID_PREFIXES.permission),
          code: permission.code,
          resource: permission.resource,
          action: permission.action,
          description: permission.description,
        },
      });
      created += 1;
      continue;
    }

    const drifted =
      current.resource !== permission.resource ||
      current.action !== permission.action ||
      current.description !== permission.description;

    if (!drifted) {
      unchanged += 1;
      continue;
    }

    await tx.permission.update({
      where: { code: permission.code },
      data: {
        resource: permission.resource,
        action: permission.action,
        description: permission.description,
      },
    });
    updated += 1;
  }

  const catalogueCodes = new Set(PERMISSIONS.map((entry) => entry.code));
  const orphaned = existing
    .map((row) => row.code)
    .filter((code) => !catalogueCodes.has(code))
    .sort();

  const notes =
    orphaned.length === 0
      ? []
      : [
          `${String(orphaned.length)} permission(s) exist in the database but ` +
            `not in the catalogue. They are kept so audit_logs stay ` +
            `resolvable, and step 3 removes them from every role: ` +
            orphaned.join(', '),
        ];

  return outcome('permissions', { created, updated, unchanged, notes });
}
