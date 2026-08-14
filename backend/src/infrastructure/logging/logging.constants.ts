/** Routes excluded from HTTP access logging — §19 "Routes à ignorer ou sampler". */
export const UNLOGGED_ROUTES: readonly string[] = [
  '/health/live',
  '/health/ready',
  '/metrics',
];

/**
 * How deep the recursive scrubber walks before giving up — see
 * `log-redaction.config.ts`. A bound is required because a cyclic object
 * would otherwise recurse forever inside a log call, turning a logging
 * statement into a crash.
 */
export const MAX_SCRUB_DEPTH = 8;

/** Replacement written in place of a redacted value. */
export const REDACTED_PLACEHOLDER = '[Redacted]';

export const HTTP_STATUS_SERVER_ERROR = 500;
export const HTTP_STATUS_CLIENT_ERROR = 400;
export const HTTP_STATUS_TOO_MANY_REQUESTS = 429;
