import {
  Body,
  Controller,
  Inject,
  Param,
  Post,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';

import { AppException } from '../../src/common/api/app-exception';
import { IdempotencyContextResolver } from '../../src/common/idempotency/idempotency-context.resolver';
import { Idempotent } from '../../src/common/idempotency/idempotency.decorator';
import { IdempotencyInterceptor } from '../../src/common/idempotency/idempotency.interceptor';
import type { RequestWithId } from '../../src/common/types/request-with-id';
import {
  ID_PREFIXES,
  newId,
} from '../../src/infrastructure/database/identifiers';
import { TENANT_SCOPED_PRISMA } from '../../src/infrastructure/database/prisma.tokens';
import type { TenantScopedPrismaClient } from '../../src/infrastructure/database/tenant-scope.extension';

/** What the e2e suite counts to decide whether the handler ran twice. */
export const PROBE_TARGET_TYPE = 'IDEMPOTENCY_PROBE';

export interface ProbeBody {
  readonly refuse?: boolean;
  readonly [field: string]: unknown;
}

/**
 * A route that exists only so the mechanism can be proven end to end.
 *
 * ## Why it is here and not in `src/`
 *
 * EVT-031 ships the mechanism before any of its consumers: check-in, offline
 * sync, imports, exports and ticket generation are sprints 09 to 12. A
 * mechanism nothing exercises is a mechanism nobody has checked, and the tests
 * ADR-0012 asks for — two organizations, a reordered body, a Redis flush —
 * only mean something against a real route, a real session and a real
 * database. Keeping the route in `test/` means it is never registered by
 * `AppModule` and can never be reached in any deployed environment.
 *
 * ## Why it writes a row
 *
 * "No duplicate" has to be counted somewhere. The business tables do not exist
 * yet, so each execution appends to `audit_logs` — an append-only table that
 * does exist — and the assertion is a `COUNT(*)`, exactly as it will be
 * against `attendance_records` in sprint 12.
 */
@Controller('idempotency-probes')
@UseInterceptors(IdempotencyInterceptor)
export class IdempotencyProbeController {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA)
    private readonly prisma: TenantScopedPrismaClient,
    private readonly contexts: IdempotencyContextResolver,
  ) {}

  /**
   * The `:probeId` segment is not decoration: it is what makes the stored
   * `route` a template rather than a URI, which is the property §3 asks for.
   */
  @Post(':probeId/executions')
  @Idempotent({ retention: '7d' })
  async execute(
    @Param('probeId') probeId: string,
    @Body() body: ProbeBody,
    @Req() request: Request,
  ) {
    const tenant = await this.contexts.resolve(request);
    const executionId = newId(ID_PREFIXES.auditLog);

    // Before the write, so a refusal leaves nothing behind — which is what
    // makes "FAILED_FINAL was replayed rather than re-run" countable.
    if (body.refuse === true) {
      throw new AppException('EVENT_NOT_ACTIVE', {
        detail: 'The probe was asked to refuse',
      });
    }

    await this.prisma.auditLog.create({
      data: {
        id: executionId,
        organizationId: tenant?.organizationId ?? null,
        actorUserId: tenant?.userId ?? null,
        targetType: PROBE_TARGET_TYPE,
        targetId: probeId,
        action: 'PROBE_EXECUTED',
        requestId: (request as RequestWithId).id,
      },
    });

    return { executionId, probeId };
  }
}
