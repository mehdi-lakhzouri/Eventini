import { ERROR_CATALOG, errorTypeUri, type ErrorCode } from './error-codes';
import type {
  FieldError,
  ProblemDetails,
  ProblemExtensions,
} from './problem-details.types';

export function buildProblemDetails(
  code: ErrorCode,
  instance: string,
  overrides: {
    readonly detail?: string;
    readonly errors?: readonly FieldError[];
    readonly retryable?: boolean;
    readonly extensions?: ProblemExtensions;
  } = {},
): ProblemDetails {
  const entry = ERROR_CATALOG[code];

  return {
    type: errorTypeUri(code),
    title: entry.title,
    status: entry.status,
    code,
    detail: overrides.detail ?? entry.title,
    instance,
    errors: overrides.errors ?? [],
    retryable: overrides.retryable ?? false,
    extensions: overrides.extensions ?? {},
  };
}
