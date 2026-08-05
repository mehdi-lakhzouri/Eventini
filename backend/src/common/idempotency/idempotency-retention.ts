import { Inject, Injectable } from '@nestjs/common';

import { TENANT_SCOPED_PRISMA } from '../../infrastructure/database/prisma.tokens';
import type { TenantScopedPrismaClient } from '../../infrastructure/database/tenant-scope.extension';

/** Large enough to make progress, small enough not to hold a long lock. */
const DEFAULT_BATCH_SIZE = 500;

/**
 * Retention purge — ADR-0012, "purge par job BullMQ quotidien sur
 * `expires_at`, par lots".
 *
 * ## Why this is not on `IdempotencyRepository`
 *
 * A purge is cross-tenant by definition: it deletes whatever has expired,
 * whoever it belonged to. Putting it on a repository whose every method takes
 * a `TenantContext` would mean either a lie in the signature or an exemption
 * that weakens a rule holding everywhere else. It is a different job, so it is
 * a different collaborator.
 *
 * ## Nothing calls it yet
 *
 * The daily job belongs to BullMQ (EVT-030), which is not merged. The ADR
 * lists the absence of a purge among its own negative consequences — "a silent
 * volume problem" — so the mechanism ships now and the schedule follows; a
 * purger that has to be written later is a purger that gets written after the
 * table has a problem.
 */
@Injectable()
export class IdempotencyRetentionPurger {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA)
    private readonly prisma: TenantScopedPrismaClient,
  ) {}

  /**
   * Deletes one batch of expired records; returns how many went.
   *
   * The `SET LOCAL` is the escape hatch migrations 8 and
   * `20260801150000_rotations_retention_escape` established, for the reason
   * spelled out in this table's migration: deleting an idempotency record is
   * how a check-in gets recorded twice, so the application cannot do it
   * casually. `SET LOCAL` is transaction-scoped, so it cannot leak onto
   * another statement sharing the pooled connection.
   */
  async purgeExpired(now: Date, batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const expired = await tx.idempotencyRecord.findMany({
        where: { expiresAt: { lte: now } },
        select: { id: true },
        take: batchSize,
      });

      if (expired.length === 0) {
        return 0;
      }

      await tx.$executeRaw`SET LOCAL eventini.retention_purge = 'on'`;

      const deleted = await tx.idempotencyRecord.deleteMany({
        where: { id: { in: expired.map((row) => row.id) } },
      });

      return deleted.count;
    });
  }
}
