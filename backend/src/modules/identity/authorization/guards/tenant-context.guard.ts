import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppException } from '../../../../common/api/app-exception';
import { isTenantContext } from '../../../../common/types/tenant-context';
import {
  CALLER_KEY,
  CONTEXT_KEY,
  type RequestWithCaller,
} from '../decorators/current-caller.decorator';
import { isPublic } from './authentication.guard';
import { ALLOWS_ORGANIZATION_SWITCH } from '../../tenant-access/decorators/allows-organization-switch.decorator';
import { TenantContextService } from '../../tenant-access/tenant-context.service';

/**
 * Steps 4 and 5: the organization and the membership.
 *
 * Lives in `authorization`, not in `tenant-access`, because
 * MODULE_DEPENDENCY_MAP.md §3 allows `authorization → tenant-access` and
 * forbids the reverse as a cycle: authorization needs the resolved tenant, the
 * tenant does not need permissions. Placing the guard beside the service it
 * calls read naturally and inverted that arrow — `forbidden-imports.spec.ts`
 * is what caught it.
 *
 * ## The forged identifier is refused here
 *
 * An `organizationId` arriving in a path, a query or a body is never used to
 * build a query. It is only ever **compared** against the context the session
 * resolved to, and a divergence is `403`. A caller who can choose the tenant
 * their queries run against has broken isolation; a caller who can choose the
 * tenant their actions are *logged* under has broken the audit trail, which is
 * quieter and worse.
 *
 * The comparison is skipped for a platform session, which legitimately has no
 * organization — those callers reach tenant data through `$unscoped`, which is
 * explicit and alertable, never through a path parameter.
 */
@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly contexts: TenantContextService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (isPublic(this.reflector, context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithCaller>();
    const caller = request[CALLER_KEY];

    if (caller === undefined) {
      // The authentication guard runs first and either attaches a caller or
      // throws. Reaching here means the chain was reordered, which is a wiring
      // mistake rather than a request to refuse politely.
      throw new AppException('AUTHENTICATION_REQUIRED');
    }

    const resolved = this.contexts.fromCaller(caller);
    request[CONTEXT_KEY] = resolved;

    // Steps 4 and 5. Without these the guard only compared identifiers, so a
    // suspended organization and a revoked membership both kept working until
    // the session expired — the cross-tenant e2e is what surfaced it.
    if (isTenantContext(resolved)) {
      const usable =
        caller.organizationStatus === 'ACTIVE' &&
        caller.organizationEnabled === true &&
        caller.membershipStatus === 'ACTIVE';

      if (!usable) {
        throw new AppException('AUTH_TENANT_DENIED');
      }
    }

    if (this.allowsSwitch(context)) {
      return true;
    }

    if (isTenantContext(resolved)) {
      const disagrees = claimedOrganizationIds(request).some(
        (claimed) => claimed !== resolved.organizationId,
      );

      if (disagrees) {
        throw new AppException('AUTH_TENANT_DENIED');
      }
    }

    return true;
  }

  private allowsSwitch(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(ALLOWS_ORGANIZATION_SWITCH, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }
}

/**
 * **Every** organization id the client named, from all three places.
 *
 * Returning the first one found was a real hole: a request could satisfy the
 * check with a matching path parameter while smuggling a different id in the
 * query string or the body, which a handler might then read. Any disagreement
 * from any source is a refusal — the caller has no business naming a tenant
 * that is not theirs, whichever field they put it in.
 */
function claimedOrganizationIds(request: Request): string[] {
  const sources = [
    request.params as Record<string, unknown> | undefined,
    request.query as Record<string, unknown> | undefined,
    request.body as Record<string, unknown> | undefined,
  ];

  return sources
    .map((source) => source?.['organizationId'])
    .filter(
      (candidate): candidate is string =>
        typeof candidate === 'string' && candidate.trim() !== '',
    );
}
