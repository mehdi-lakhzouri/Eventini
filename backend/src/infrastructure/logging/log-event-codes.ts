import type { LogCategory } from './log-categories';

/**
 * The stable `eventCode` catalogue — PINO_LOGGING_SPECIFICATION.md §10.
 *
 * Messages (`msg`) are prose and may be reworded freely. `eventCode` is the
 * machine contract: dashboards, alert rules and saved queries are written
 * against these strings, so renaming one silently breaks an alert rather than
 * failing a build. Add codes; do not rename them.
 *
 * This is a *different namespace* from `common/api/error-codes.ts` — §10 and
 * ADR-0008 both say so explicitly. `RATE_LIMIT_EXCEEDED` can legitimately
 * exist in both with no relationship between them; they are not synchronised.
 *
 * Each code carries its natural category so a caller cannot pair
 * `LOGIN_FAILED` with `CACHE` by accident.
 */
export const LOG_EVENT_CODES = {
  // System lifecycle
  APPLICATION_STARTED: 'SYSTEM',
  APPLICATION_STOPPING: 'SYSTEM',
  APPLICATION_START_FAILED: 'SYSTEM',
  UNCAUGHT_EXCEPTION: 'SYSTEM',
  UNHANDLED_REJECTION: 'SYSTEM',

  // HTTP
  HTTP_REQUEST_COMPLETED: 'HTTP_ACCESS',
  HTTP_REQUEST_FAILED: 'HTTP_ACCESS',
  SLOW_HTTP_REQUEST: 'PERFORMANCE',

  // Dependencies
  DATABASE_CONNECTED: 'DATABASE',
  DATABASE_CONNECTION_FAILED: 'DATABASE',
  SLOW_DATABASE_QUERY: 'PERFORMANCE',
  REDIS_CONNECTED: 'CACHE',
  REDIS_FALLBACK_ACTIVATED: 'CACHE',

  // Queues
  JOB_STARTED: 'QUEUE',
  JOB_RETRY_SCHEDULED: 'QUEUE',
  JOB_SUCCEEDED: 'QUEUE',
  JOB_FAILED_FINAL: 'QUEUE',
  EMAIL_QUEUED: 'QUEUE',
  EMAIL_ENQUEUE_FAILED: 'QUEUE',

  // Authentication and security
  LOGIN_SUCCEEDED: 'SECURITY',
  LOGIN_FAILED: 'SECURITY',
  ACCOUNT_LOCKED: 'SECURITY',
  SESSION_CREATED: 'SECURITY',
  SESSION_REVOKED: 'SECURITY',
  REFRESH_TOKEN_REUSE_DETECTED: 'SECURITY',
  CSRF_VALIDATION_FAILED: 'SECURITY',
  TENANT_ACCESS_DENIED: 'SECURITY',

  /**
   * The tenant guard was bypassed through `prisma.$unscoped` (ADR-0003,
   * EVT-018).
   *
   * Absent from §10's list, and added because ADR-0003 and
   * BACKEND_ARCHITECTURE.md §6 both mandate logging with exactly this code —
   * a code the architecture requires and the catalogue omits cannot be
   * alerted on, which is the entire purpose of the escape hatch being logged.
   * It already exists as a `SecurityEventType` in `enums.ts`; the two
   * namespaces are separate (§10, ADR-0008), so it needs declaring in both.
   */
  UNSCOPED_QUERY_EXECUTED: 'SECURITY',

  /**
   * A row could not be written to `security_events` — EVT-077.
   *
   * `SecurityEventRecorder` never rethrows, because a recording failure must
   * not turn an otherwise valid login into a 500. That choice is only
   * defensible if the failure is loud somewhere else, and this is where: a
   * security table that quietly stops filling up is worth less than no table
   * at all, because people trust it.
   */
  SECURITY_EVENT_WRITE_FAILED: 'SECURITY',

  // Business and audit
  ROLE_CHANGED: 'AUDIT',
  ORGANIZATION_SUSPENDED: 'AUDIT',

  // Application-level failures that are not HTTP-shaped
  UNHANDLED_APPLICATION_ERROR: 'APPLICATION',
} as const satisfies Record<string, LogCategory>;

export type LogEventCode = keyof typeof LOG_EVENT_CODES;

/** The category a given event code belongs to. */
export function categoryForEventCode(code: LogEventCode): LogCategory {
  return LOG_EVENT_CODES[code];
}
