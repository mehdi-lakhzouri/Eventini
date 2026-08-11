import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppException } from '../../../common/api/app-exception';
import { isTenantContext } from '../../../common/types/tenant-context';
import {
  CALLER_KEY,
  CONTEXT_KEY,
  type RequestWithCaller,
} from '../authorization/decorators/current-caller.decorator';
import { isPublic } from '../authorization/guards/authentication.guard';
import { ALLOWS_ORGANIZATION_SWITCH } from './decorators/allows-organization-switch.decorator';
import { TenantContextService } from './tenant-context.service';

/**
 * Steps 4 and 5: the organization and the membership.
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

    if (this.allowsSwitch(context)) {
      return true;
    }

    const claimed = claimedOrganizationId(request);

    if (
      claimed !== null &&
      isTenantContext(resolved) &&
      claimed !== resolved.organizationId
    ) {
      throw new AppException('AUTH_TENANT_DENIED');
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
 * The organization id the *client* named, wherever it named it.
 *
 * Read from all three places on purpose. Checking only the path would leave a
 * body field free to disagree with the session, and the mismatch would then be
 * decided by whichever layer happened to read it first.
 */
function claimedOrganizationId(request: Request): string | null {
  const fromParams = (request.params as Record<string, unknown> | undefined)?.[
    'organizationId'
  ];
  const fromQuery = (request.query as Record<string, unknown> | undefined)?.[
    'organizationId'
  ];
  const fromBody = (request.body as Record<string, unknown> | undefined)?.[
    'organizationId'
  ];

  for (const candidate of [fromParams, fromQuery, fromBody]) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate;
    }
  }

  return null;
}
