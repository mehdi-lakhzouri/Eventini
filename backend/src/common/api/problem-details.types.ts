import type { ErrorCode } from './error-codes';

/** One field-level validation failure, per API_CONVENTIONS.md §3. */
export interface FieldError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

/** RFC 9457 Problem Details, shaped per ADR-0008. */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: ErrorCode;
  readonly detail: string;
  readonly instance: string;
  readonly errors: readonly FieldError[];
  readonly retryable: boolean;
}

export interface ResponseMeta {
  readonly requestId: string;
  readonly timestamp: string;
  readonly apiVersion: 'v1';
}

/** The envelope every response carries — `data`/`meta`/`error` are always present. */
export interface ApiEnvelope<T> {
  readonly data: T | null;
  readonly meta: ResponseMeta;
  readonly error: ProblemDetails | null;
}
