import { HttpException } from '@nestjs/common';

import { buildProblemDetails } from './build-problem-details';
import { DEFAULT_CODE_BY_STATUS } from './error-codes';
import type { ProblemDetails } from './problem-details.types';

/**
 * Maps anything the filter catches that is *not* an `AppException` — a
 * framework exception thrown before a controller ever runs (unmatched
 * route, malformed JSON body), or a genuine bug (a thrown `Error`, a Prisma
 * error, anything). Never reads `exception.message` for the latter case:
 * that string can carry a table name, a file path, or a query fragment, and
 * `AUTHENTICATION_AUTHORIZATION.md` §7 and `API_CONVENTIONS.md` §4 both
 * forbid leaking it.
 */
export function mapUnknownException(
  exception: unknown,
  instance: string,
): ProblemDetails {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const code = DEFAULT_CODE_BY_STATUS[status] ?? 'INTERNAL_ERROR';
    return buildProblemDetails(code, instance);
  }

  return buildProblemDetails('INTERNAL_ERROR', instance, {
    detail: 'An unexpected error occurred.',
  });
}

const INTERNAL_SERVER_ERROR_STATUS = 500;

export function isServerError(problem: ProblemDetails): boolean {
  return problem.status >= INTERNAL_SERVER_ERROR_STATUS;
}
