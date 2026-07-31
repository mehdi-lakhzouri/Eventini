/**
 * Returns the path without its query string.
 *
 * Query strings routinely carry one-time credentials — a password-reset
 * token, an invitation token, an email-verification token — and the RFC 9457
 * `instance` field is both written to the log store and echoed in the error
 * response. Keeping the query string there leaked a token into the logs, seen
 * in real output as
 * `"operation":"GET /api/v1/nonexistent?token=LEAKCANARY123"`, which is
 * exactly what PINO_LOGGING_SPECIFICATION.md §31 forbids.
 *
 * `instance` is meant to identify which resource the problem occurred on, and
 * the path alone does that.
 */
export function stripQueryString(url: string): string {
  const queryStart = url.indexOf('?');
  return queryStart === -1 ? url : url.slice(0, queryStart);
}
