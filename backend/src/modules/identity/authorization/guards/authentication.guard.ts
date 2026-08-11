import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { toCallerException } from '../../authentication/infrastructure/caller-exception.mapper';
import { CallerResolver } from '../../authentication/infrastructure/caller.resolver';
import {
  CALLER_KEY,
  type RequestWithCaller,
} from '../decorators/current-caller.decorator';
import { IS_PUBLIC } from '../../../../common/decorators';

/**
 * Steps 1 to 3: the token, the session, the user.
 *
 * Global, so a route is authenticated unless it says otherwise. `@Public()` is
 * the only exit, and it is one visible line in a diff — whereas a guard applied
 * per route turns a *missing* line into an open endpoint, which no one notices
 * because it answers `200`.
 *
 * The resolved caller is attached to the request so the handler does not repeat
 * the work. That is not only a saved round trip: two resolutions can disagree
 * if the session is revoked in between, and the handler would then act on a
 * different caller than the one the guard admitted.
 */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly caller: CallerResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublic(this.reflector, context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithCaller>();

    const resolved = await this.caller
      .resolve(request)
      .catch((error: unknown) => {
        throw toCallerException(error);
      });

    request[CALLER_KEY] = resolved;

    return true;
  }
}

/**
 * Checked on the handler *and* the controller, so a whole controller can be
 * opened at once — `getAllAndOverride` lets the handler win, which is what
 * makes a single protected route inside a public controller expressible.
 */
export function isPublic(
  reflector: Reflector,
  context: ExecutionContext,
): boolean {
  return (
    reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]) === true
  );
}
