import { Injectable } from '@nestjs/common';

import type {
  PlatformContext,
  RequestContext,
  TenantContext,
} from '../../../common/types/tenant-context';
import type { Caller } from '../authentication/infrastructure/caller.resolver';

/**
 * Turns a resolved caller into the context every scoped query must carry.
 *
 * The only input is the session row the authentication chain already loaded.
 * Nothing here reads a path, a query string or a body — ADR-0002: an
 * `organizationId` from the client is only ever *compared* against this, never
 * used to build one. A caller who can choose the tenant their queries run
 * against has broken isolation; a caller who can choose the tenant their
 * actions are *logged* under has broken the audit trail, which is quieter and
 * worse.
 */
@Injectable()
export class TenantContextService {
  /**
   * A session with no organization is a platform session, and gets a different
   * *type* rather than a `TenantContext` with null fields — the call site that
   * forgets `if (ctx.organizationId)` is the one that leaks.
   */
  fromCaller(caller: Caller): RequestContext {
    if (caller.organizationId === null || caller.membershipId === null) {
      return {
        userId: caller.userId,
        sessionId: caller.sessionId,
        authLevel: caller.authenticationLevel,
      } satisfies PlatformContext;
    }

    return {
      organizationId: caller.organizationId,
      membershipId: caller.membershipId,
      userId: caller.userId,
      sessionId: caller.sessionId,
      authLevel: caller.authenticationLevel,
    } satisfies TenantContext;
  }
}
