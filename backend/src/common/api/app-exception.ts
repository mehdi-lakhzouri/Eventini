import { HttpException } from '@nestjs/common';

import { ERROR_CATALOG, type ErrorCode } from './error-codes';
import type { FieldError, ProblemExtensions } from './problem-details.types';

export interface AppExceptionOptions {
  readonly detail?: string;
  readonly errors?: readonly FieldError[];
  readonly retryable?: boolean;
  readonly extensions?: ProblemExtensions;
}

/**
 * The exception application code should throw for every known failure —
 * `code` is always one of `ERROR_CATALOG`'s keys, so the HTTP status and
 * RFC 9457 `type`/`title` can never drift from the published catalogue.
 * `HttpExceptionFilter` reads `code`/`errors`/`retryable` straight off this
 * class; anything else it catches is a framework exception or a genuine bug,
 * mapped by `mapUnknownException` instead.
 */
export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly errors: readonly FieldError[];
  readonly retryable: boolean;
  readonly detail: string;
  readonly extensions: ProblemExtensions;

  constructor(code: ErrorCode, options: AppExceptionOptions = {}) {
    const entry = ERROR_CATALOG[code];
    const detail = options.detail ?? entry.title;
    super(detail, entry.status);
    this.code = code;
    this.detail = detail;
    this.errors = options.errors ?? [];
    this.retryable = options.retryable ?? false;
    this.extensions = options.extensions ?? {};
  }
}
