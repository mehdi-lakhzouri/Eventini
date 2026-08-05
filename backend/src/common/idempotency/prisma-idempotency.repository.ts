import { Inject, Injectable } from '@nestjs/common';

import type { IdempotencyStatus } from '../../infrastructure/database/enums';
import {
  ID_PREFIXES,
  newId,
} from '../../infrastructure/database/identifiers';
import { Prisma } from '../../infrastructure/database/prisma/generated/client';
import { TENANT_SCOPED_PRISMA } from '../../infrastructure/database/prisma.tokens';
import type { TenantScopedPrismaClient } from '../../infrastructure/database/tenant-scope.extension';
import type { TenantContext } from '../types/tenant-context';
import {
  IdempotencyRepository,
  type ClaimInput,
  type IdempotencyRecordView,
  type IdempotencyScope,
  type ReclaimInput,
  type SettleInput,
} from './idempotency.repository';
import { parseStoredResponse, type StoredResponse } from './stored-response';

@Injectable()
export class PrismaIdempotencyRepository extends IdempotencyRepository {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA)
    private readonly prisma: TenantScopedPrismaClient,
  ) {
    super();
  }

  /**
   * `createMany({ skipDuplicates: true })` rather than `$queryRaw`.
   *
   * Prisma compiles it to exactly the `INSERT ... ON CONFLICT DO NOTHING` of
   * ADR-0012, and `count` is the `RETURNING id` — one row inserted means the
   * claim is ours, zero means the key was already taken. Writing the statement
   * by hand would have been closer to the ADR's text and strictly worse: raw
   * SQL is invisible to the tenant-scope extension, so the one query in this
   * file that decides whether a check-in happens would have been the one query
   * the guard could not see.
   *
   * `DO NOTHING` carries no conflict target on purpose. The table has two
   * unique indexes — `ux_idempotency_scope` and the partial
   * `ux_idempotency_scope_platform` — and no single target names both;
   * untargeted `DO NOTHING` is their union, which is what "the key is already
   * taken" means.
   */
  async claim(context: TenantContext, input: ClaimInput): Promise<string | null> {
    const id = newId(ID_PREFIXES.idempotency);

    const inserted = await this.prisma.idempotencyRecord.createMany({
      data: [
        {
          id,
          organizationId: context.organizationId,
          actorId: input.scope.actorId,
          actorSessionId: input.actorSessionId,
          method: input.scope.method,
          route: input.scope.route,
          idempotencyKey: input.scope.key,
          requestHash: input.requestHash,
          status: 'PENDING' satisfies IdempotencyStatus,
          expiresAt: input.expiresAt,
          lockedUntil: input.lockedUntil,
        },
      ],
      skipDuplicates: true,
    });

    return inserted.count === 1 ? id : null;
  }

  async find(
    context: TenantContext,
    scope: IdempotencyScope,
  ): Promise<IdempotencyRecordView | null> {
    const row = await this.prisma.idempotencyRecord.findFirst({
      where: {
        organizationId: context.organizationId,
        actorId: scope.actorId,
        method: scope.method,
        route: scope.route,
        idempotencyKey: scope.key,
      },
      select: {
        id: true,
        status: true,
        requestHash: true,
        expiresAt: true,
        lockedUntil: true,
        responseStatus: true,
        responseBody: true,
      },
    });

    if (row === null) {
      return null;
    }

    return {
      id: row.id,
      status: row.status as IdempotencyStatus,
      requestHash: row.requestHash,
      expiresAt: row.expiresAt,
      lockedUntil: row.lockedUntil,
      responseStatus: row.responseStatus,
      response: parseStoredResponse(row.responseBody),
    };
  }

  async reclaim(context: TenantContext, input: ReclaimInput): Promise<boolean> {
    const updated = await this.prisma.idempotencyRecord.updateMany({
      where: {
        id: input.recordId,
        organizationId: context.organizationId,
        // The compare-and-swap. Two requests can observe the same lapsed lock;
        // both then try this, and the second matches nothing because the first
        // has already moved `lockedUntil`.
        status: input.expectedStatus,
        lockedUntil: input.expectedLockedUntil,
      },
      data: {
        status: 'PENDING' satisfies IdempotencyStatus,
        requestHash: input.requestHash,
        expiresAt: input.expiresAt,
        lockedUntil: input.lockedUntil,
        responseStatus: null,
        // Clearing the memorised response matters: a reclaimed row that kept
        // it could answer a later replay with the previous attempt's body.
        responseBody: Prisma.DbNull,
        responseRef: null,
      },
    });

    return updated.count === 1;
  }

  async settle(context: TenantContext, input: SettleInput): Promise<void> {
    await this.prisma.idempotencyRecord.updateMany({
      where: { id: input.recordId, organizationId: context.organizationId },
      data: {
        status: input.status,
        responseStatus: input.responseStatus,
        responseBody: toJsonInput(input.response),
        // The claim is over either way; leaving the lock set would keep the
        // row looking in flight to `reclaim`.
        lockedUntil: null,
      },
    });
  }
}

/**
 * The round trip through `JSON.stringify` is not ceremony: a handler's return
 * value can contain `Date`s and `undefined`s, and the column can hold neither.
 * Doing it here means the stored value is what a replay will read back, rather
 * than something the driver coerced on the way in.
 */
function toJsonInput(
  response: StoredResponse | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return response === null
    ? Prisma.DbNull
    : (JSON.parse(JSON.stringify(response)) as Prisma.InputJsonValue);
}
