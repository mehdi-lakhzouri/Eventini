import { Injectable } from '@nestjs/common';

import { PrismaService } from './prisma.service';
import type { Prisma } from './prisma/generated/client';

/**
 * The client handed to work running inside `runInTransaction`.
 *
 * Taken from Prisma's own `Prisma.TransactionClient` rather than hand-rolled
 * with `Omit`. Prisma decides which operations are unavailable inside an
 * interactive transaction — `$connect`, `$disconnect`, `$on`, `$use`,
 * `$extends`, and `$transaction` itself — through an internal deny list, and
 * a hand-written approximation drifts from it silently on any upgrade. The
 * first attempt here omitted four of those six and failed to compile against
 * the real callback signature, which is the drift arriving immediately rather
 * than in six months.
 */
export type TransactionalClient = Prisma.TransactionClient;

@Injectable()
export class TransactionManager {
  constructor(private readonly prisma: PrismaService) {}

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
