import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { RequestContext } from '../../../../common/types/tenant-context';
import type { Caller } from '../../authentication/infrastructure/caller.resolver';

/** Where the guard chain leaves what it resolved. */
export const CALLER_KEY = 'eventiniCaller';
export const CONTEXT_KEY = 'eventiniContext';

export interface RequestWithCaller extends Request {
  [CALLER_KEY]?: Caller;
  [CONTEXT_KEY]?: RequestContext;
}

/**
 * The caller the chain already verified.
 *
 * Reading it here rather than re-resolving in the controller is not only about
 * saving a round trip: two resolutions can disagree. A session revoked between
 * the guard and the handler would leave the guard's decision and the
 * controller's view of the caller describing different states, and the handler
 * would act on the second while having been admitted by the first.
 *
 * Throws rather than returning `undefined` when nothing is there. That can only
 * happen on a `@Public()` route, where asking for a caller is a mistake in the
 * handler rather than a condition to branch on.
 */
export const CurrentCaller = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Caller => {
    const request = context.switchToHttp().getRequest<RequestWithCaller>();
    const caller = request[CALLER_KEY];

    if (caller === undefined) {
      throw new Error(
        'No caller on the request. @CurrentCaller() cannot be used on a @Public() route.',
      );
    }

    return caller;
  },
);

/**
 * The tenant context, for a handler that will scope a query with it.
 *
 * A platform session resolves to a `PlatformContext`, which has no
 * `organizationId` — the narrowing is the caller's job, and the type makes it
 * impossible to forget.
 */
export const CurrentContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestContext => {
    const request = context.switchToHttp().getRequest<RequestWithCaller>();
    const resolved = request[CONTEXT_KEY];

    if (resolved === undefined) {
      throw new Error(
        'No tenant context on the request. @CurrentContext() cannot be used on a @Public() route.',
      );
    }

    return resolved;
  },
);
