import { AppException } from '../../../../common/api/app-exception';
import { CallerError } from './caller.resolver';

/**
 * The one translation from `CallerResolver`'s rejection reasons to a response,
 * shared by every route that resolves a caller.
 *
 * Kept in one place rather than copied per controller: two independently
 * maintained copies would drift, and a caller refused for `STALE_VERSION` by
 * one route but not another is exactly the kind of inconsistency this chain
 * exists to prevent.
 */
export function toCallerException(error: unknown): unknown {
  if (!(error instanceof CallerError)) {
    return error;
  }

  switch (error.rejection) {
    case 'SESSION_EXPIRED':
      return new AppException('AUTH_SESSION_EXPIRED');
    case 'SESSION_GONE':
    case 'STALE_VERSION':
      return new AppException('AUTH_SESSION_REVOKED');
    default:
      return new AppException('AUTHENTICATION_REQUIRED');
  }
}
