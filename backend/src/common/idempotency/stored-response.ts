import { ERROR_CATALOG, type ErrorCode } from '../api/error-codes';
import type {
  FieldError,
  ProblemExtensions,
} from '../api/problem-details.types';

/**
 * What `idempotency_records.response_body` holds.
 *
 * ## Why the original request id is in here rather than in a column
 *
 * §7 requires the replay to answer with
 * `meta.idempotency.originalRequestId` — without it, a replayed response
 * cannot be tied back to the execution that actually happened, which is the
 * only reason the field exists. DATABASE_SCHEMA.md §8.3's column list has no
 * `request_id`, and that list is normative, so inventing a fourteenth column
 * was not an option. `response_body` is JSONB precisely so the stored
 * representation can carry what a replay needs; its internal shape is ours.
 *
 * ## Why a failure is memorised at all
 *
 * §5: replaying a definitive `409 EVENT_NOT_ACTIVE` would re-run the
 * operation, reach the same refusal and spend a database round trip proving
 * it. The refusal is the answer, so it is stored like any other.
 */
export interface StoredSuccess {
  readonly kind: 'SUCCESS';
  readonly requestId: string;
  readonly data: unknown;
}

export interface StoredFailure {
  readonly kind: 'FAILURE';
  readonly requestId: string;
  readonly code: ErrorCode;
  readonly detail: string;
  readonly errors: readonly FieldError[];
  readonly retryable: boolean;
  readonly extensions: ProblemExtensions;
}

export type StoredResponse = StoredSuccess | StoredFailure;

/**
 * Reads a stored response back, or `null` if it is not one.
 *
 * `null` rather than a throw: the value comes out of a JSONB column that an
 * older release wrote, and a replay that cannot be understood should fall back
 * to re-executing rather than fail the request with a parse error.
 */
export function parseStoredResponse(value: unknown): StoredResponse | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const stored = value as Record<string, unknown>;
  const requestId = stored['requestId'];

  if (typeof requestId !== 'string') {
    return null;
  }

  if (stored['kind'] === 'SUCCESS') {
    return { kind: 'SUCCESS', requestId, data: stored['data'] ?? null };
  }

  if (stored['kind'] !== 'FAILURE') {
    return null;
  }

  const code = stored['code'];

  if (typeof code !== 'string' || !(code in ERROR_CATALOG)) {
    return null;
  }

  return {
    kind: 'FAILURE',
    requestId,
    code: code as ErrorCode,
    detail:
      typeof stored['detail'] === 'string'
        ? stored['detail']
        : ERROR_CATALOG[code as ErrorCode].title,
    errors: Array.isArray(stored['errors'])
      ? (stored['errors'] as FieldError[])
      : [],
    retryable: stored['retryable'] === true,
    extensions:
      typeof stored['extensions'] === 'object' && stored['extensions'] !== null
        ? (stored['extensions'] as ProblemExtensions)
        : {},
  };
}
