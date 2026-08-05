import { Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { IdempotencyContextResolver } from '../../../../common/idempotency/idempotency-context.resolver';
import type { TenantContext } from '../../../../common/types/tenant-context';
import { toCallerException } from './caller-exception.mapper';
import { CallerResolver } from './caller.resolver';

/**
 * The idempotency port, satisfied by steps 1 to 3 of the authorization chain.
 *
 * A seam, and a temporary one: EVT-036's global guard resolves the context
 * once per request and puts it on the request object, at which point this
 * class is a property read. It exists because the interceptor needs
 * `organizationId` and `actorId` today and the guard does not exist yet —
 * exactly the gap `CallerResolver` was extracted to fill for `/auth/me`.
 */
@Injectable()
export class CallerIdempotencyContextResolver extends IdempotencyContextResolver {
  constructor(private readonly caller: CallerResolver) {
    super();
  }

  async resolve(request: Request): Promise<TenantContext | null> {
    const caller = await this.caller
      .resolve(request)
      .catch((error: unknown) => {
        throw toCallerException(error);
      });

    // A platform session (ADR-0002) carries neither, and
    // `ck_sessions_tenant_coherence` guarantees the two move together.
    if (caller.organizationId === null || caller.membershipId === null) {
      return null;
    }

    return {
      organizationId: caller.organizationId,
      membershipId: caller.membershipId,
      userId: caller.userId,
      sessionId: caller.sessionId,
      authLevel: caller.authenticationLevel,
    };
  }
}
