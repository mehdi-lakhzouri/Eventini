import { Inject, Injectable } from '@nestjs/common';

import { TENANT_SCOPED_PRISMA } from './prisma.tokens';
import type { TenantScopedPrismaClient } from './tenant-scope.extension';

/**
 * The client handed to work running inside `runInTransaction`.
 *
 * Read off the extended client's own `$transaction` signature rather than
 * hand-rolled with `Omit`. Prisma decides which operations are unavailable
 * inside an interactive transaction — `$connect`, `$disconnect`, `$on`,
 * `$use`, `$extends` — through an internal deny list, and a hand-written
 * approximation drifts from it silently on any upgrade. An earlier attempt
 * omitted four of those and failed to compile against the real callback
 * signature, which is the drift arriving immediately rather than in six
 * months.
 *
 * It was `Prisma.TransactionClient` until EVT-018. That type describes the
 * *unextended* client, so once the manager started its transactions from the
 * guarded client the two stopped matching — which is TypeScript reporting the
 * exact thing that mattered: work inside a transaction now runs against a
 * client that carries the tenant guard, and its type has to say so.
 */
type InteractiveTransactionCallback = Parameters<
  TenantScopedPrismaClient['$transaction']
>[0];

export type TransactionalClient = InteractiveTransactionCallback extends (
  client: infer Client,
) => unknown
  ? Client
  : never;

@Injectable()
export class TransactionManager {
  constructor(
    /**
     * The **extended** client, not `PrismaService` (EVT-018).
     *
     * `$transaction` hands the callback a client derived from the one it was
     * called on, so starting a transaction from the unguarded service would
     * hand every use case an unguarded `tx` — the guard would hold for single
     * queries and silently stop holding for exactly the multi-step writes
     * that touch the most tenant data. Verified against a live client: query
     * extensions do fire inside an interactive transaction, provided the
     * transaction started from the extended client.
     */
    @Inject(TENANT_SCOPED_PRISMA)
    private readonly prisma: TenantScopedPrismaClient,
  ) {}

  /**
   * Runs `work` inside a single interactive transaction.
   *
   * Exists so a use case never reaches for `prisma.$transaction` directly.
   * BACKEND_ARCHITECTURE.md §3 puts transaction orchestration in the
   * application layer, and centralising it here is what makes it possible to
   * later attach the tenant-scope extension (ADR-0003, EVT-018), timeouts, or
   * retry-on-serialization-failure in one place rather than at every call
   * site that remembered to.
   *
   * Everything inside commits or rolls back together — which is the point for
   * an operation like "create the membership, assign the role, write the
   * audit entry", where a partial success leaves an untraceable state that
   * INV-O3 exists to prevent.
   */
  async runInTransaction<T>(
    work: (tx: TransactionalClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => work(tx));
  }
}
