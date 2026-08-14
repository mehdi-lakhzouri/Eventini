import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppException } from '../../../../common/api/app-exception';
import {
  isTenantContext,
  type AuthLevel,
  type RequestContext,
} from '../../../../common/types/tenant-context';
import { PermissionResolver } from '../application/permission-resolver.service';
import {
  CONTEXT_KEY,
  type RequestWithCaller,
} from '../decorators/current-caller.decorator';
import { IS_PUBLIC } from '../../../../common/decorators';
import {
  REQUIRED_AUTH_LEVEL,
  satisfiesAuthLevel,
} from '../decorators/require-auth-level.decorator';
import {
  REQUIRED_PERMISSION,
  type RequiredPermission,
} from '../decorators/require-permission.decorator';

/**
 * Step 6: the requested permission is in the caller's effective set.
 *
 * Nothing is read from the access token — the set is resolved per request, so a
 * revoked role stops granting the moment its transaction commits rather than
 * whenever the token happens to expire. That is the property ADR-0004 exists
 * for, and this guard is where it becomes visible to a caller.
 *
 * The authentication level is checked here too. It belongs with permissions
 * rather than with authentication: whether a session is strong *enough* is a
 * question about the operation being attempted, not about who is attempting it.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.metadata<boolean>(context, IS_PUBLIC) === true) {
      return true;
    }

    const resolved = context.switchToHttp().getRequest<RequestWithCaller>()[
      CONTEXT_KEY
    ];

    if (resolved === undefined) {
      throw new AppException('AUTHENTICATION_REQUIRED');
    }

    this.assertAuthLevel(context, resolved);

    const required = this.metadata<RequiredPermission>(
      context,
      REQUIRED_PERMISSION,
    );

    // No declaration means no *specific* permission — the route is still
    // authenticated and still tenant-checked. Reading your own profile is the
    // shape that wants this; anything else should say what it needs.
    if (required === undefined) {
      return true;
    }

    const granted = await this.effectiveSet(required, resolved, context);

    if (!granted.includes(required.code)) {
      throw new AppException('AUTH_PERMISSION_DENIED');
    }

    return true;
  }

  /**
   * `REAUTHENTICATED` satisfies a route asking for `MFA`: it proved more, not
   * less. Its own code is returned so a client knows to re-prove rather than
   * to give up, which a bare `403` would not distinguish.
   */
  private assertAuthLevel(
    context: ExecutionContext,
    resolved: RequestContext,
  ): void {
    const required = this.metadata<AuthLevel>(context, REQUIRED_AUTH_LEVEL);

    if (
      required !== undefined &&
      !satisfiesAuthLevel(resolved.authLevel, required)
    ) {
      throw new AppException('AUTH_REAUTHENTICATION_REQUIRED');
    }
  }

  private async effectiveSet(
    required: RequiredPermission,
    resolved: RequestContext,
    context: ExecutionContext,
  ): Promise<string[]> {
    if (required.scope === 'PLATFORM') {
      return this.permissions.forPlatform(resolved.userId);
    }

    // Everything below needs a membership, which a platform session has not
    // got. Refusing is right: a platform administrator reaches tenant data
    // through `$unscoped`, deliberately and audibly, not by inheriting an
    // organization permission they were never granted.
    if (!isTenantContext(resolved)) {
      throw new AppException('AUTH_TENANT_DENIED');
    }

    if (required.scope === 'ORGANIZATION') {
      return this.permissions.forMembership(resolved.membershipId);
    }

    const eventId = this.eventIdFrom(context, required);

    if (eventId === null) {
      // The route asked for an event permission without saying which event.
      // Granting on an empty set would be an accidental allow-all, so this is
      // a wiring mistake that must fail loudly rather than quietly permit.
      throw new AppException('AUTH_PERMISSION_DENIED');
    }

    return this.permissions.forEvent(resolved.membershipId, eventId);
  }

  private eventIdFrom(
    context: ExecutionContext,
    required: RequiredPermission,
  ): string | null {
    const params = context.switchToHttp().getRequest<RequestWithCaller>()
      .params as Record<string, unknown> | undefined;
    const raw = params?.[required.eventParam ?? 'eventId'];

    return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
  }

  private metadata<T>(context: ExecutionContext, key: string): T | undefined {
    return this.reflector.getAllAndOverride<T>(key, [
      context.getHandler(),
      context.getClass(),
    ]);
  }
}
