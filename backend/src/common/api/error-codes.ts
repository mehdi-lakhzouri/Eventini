/**
 * The single `error.code` namespace, per API_CONVENTIONS.md §4 and
 * ADR-0008. Every code maps to the HTTP status it always carries, an
 * RFC 9457 `title`, and the URI slug used for `type`
 * (`https://errors.eventini.com/{slug}`).
 *
 * `AUTH_ACCOUNT_LOCKED` is deliberately absent: AUTHENTICATION_AUTHORIZATION.md
 * §7 requires it never reach a client (it would confirm an account's
 * existence to whoever locked it out) — a locked account gets
 * `AUTH_INVALID_CREDENTIALS` instead, same as any other failed login.
 */
export const ERROR_CATALOG = {
  // General — API_CONVENTIONS.md §4
  VALIDATION_ERROR: {
    status: 400,
    title: 'Validation failed',
    slug: 'validation-error',
  },
  RESOURCE_NOT_FOUND: {
    status: 404,
    title: 'Resource not found',
    slug: 'resource-not-found',
  },
  RESOURCE_ALREADY_EXISTS: {
    status: 409,
    title: 'Resource already exists',
    slug: 'resource-already-exists',
  },
  VERSION_CONFLICT: {
    status: 409,
    title: 'Version conflict',
    slug: 'version-conflict',
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    title: 'Idempotency key conflict',
    slug: 'idempotency-conflict',
  },
  PRECONDITION_FAILED: {
    status: 412,
    title: 'Precondition failed',
    slug: 'precondition-failed',
  },
  PRECONDITION_REQUIRED: {
    status: 428,
    title: 'Precondition required',
    slug: 'precondition-required',
  },
  PAYLOAD_TOO_LARGE: {
    status: 413,
    title: 'Payload too large',
    slug: 'payload-too-large',
  },
  UNSUPPORTED_MEDIA_TYPE: {
    status: 415,
    title: 'Unsupported media type',
    slug: 'unsupported-media-type',
  },
  RATE_LIMIT_EXCEEDED: {
    status: 429,
    title: 'Rate limit exceeded',
    slug: 'rate-limit-exceeded',
  },
  INTERNAL_ERROR: {
    status: 500,
    title: 'Internal server error',
    slug: 'internal-error',
  },
  DEPENDENCY_UNAVAILABLE: {
    status: 503,
    title: 'Dependency unavailable',
    slug: 'dependency-unavailable',
  },

  // Authentication and authorization — AUTHENTICATION_AUTHORIZATION.md §7
  AUTHENTICATION_REQUIRED: {
    status: 401,
    title: 'Authentication required',
    slug: 'authentication-required',
  },
  AUTH_INVALID_CREDENTIALS: {
    status: 401,
    title: 'Invalid credentials',
    slug: 'invalid-credentials',
  },
  AUTH_SESSION_EXPIRED: {
    status: 401,
    title: 'Session expired',
    slug: 'session-expired',
  },
  AUTH_SESSION_REVOKED: {
    status: 401,
    title: 'Session revoked',
    slug: 'session-revoked',
  },
  AUTH_MFA_REQUIRED: {
    status: 401,
    title: 'Multi-factor authentication required',
    slug: 'mfa-required',
  },
  AUTH_MFA_INVALID: {
    status: 401,
    title: 'Multi-factor authentication code invalid',
    slug: 'mfa-invalid',
  },
  AUTH_CSRF_INVALID: {
    status: 403,
    title: 'CSRF validation failed',
    slug: 'csrf-invalid',
  },
  AUTH_ORIGIN_DENIED: {
    status: 403,
    title: 'Origin not allowed',
    slug: 'origin-denied',
  },
  AUTH_TENANT_DENIED: {
    status: 403,
    title: 'Tenant access denied',
    slug: 'tenant-access-denied',
  },
  AUTH_PERMISSION_DENIED: {
    status: 403,
    title: 'Permission denied',
    slug: 'permission-denied',
  },
  AUTH_REAUTHENTICATION_REQUIRED: {
    status: 403,
    title: 'Reauthentication required',
    slug: 'reauthentication-required',
  },
  AUTH_REFRESH_REUSE_DETECTED: {
    status: 401,
    title: 'Refresh token reuse detected',
    slug: 'refresh-reuse-detected',
  },

  // Business — API_CONVENTIONS.md §4
  ORGANIZATION_SUSPENDED: {
    status: 403,
    title: 'Organization suspended',
    slug: 'organization-suspended',
  },
  EVENT_NOT_ACTIVE: {
    status: 409,
    title: 'Event not active',
    slug: 'event-not-active',
  },
  EVENT_SESSION_CLOSED: {
    status: 409,
    title: 'Event session closed',
    slug: 'event-session-closed',
  },
  CHECK_IN_WINDOW_CLOSED: {
    status: 409,
    title: 'Check-in window closed',
    slug: 'check-in-window-closed',
  },
  ALREADY_CHECKED_IN: {
    status: 409,
    title: 'Already checked in',
    slug: 'already-checked-in',
  },
  TICKET_REVOKED: {
    status: 409,
    title: 'Ticket revoked',
    slug: 'ticket-revoked',
  },
  TICKET_INVALID: {
    status: 400,
    title: 'Ticket invalid',
    slug: 'ticket-invalid',
  },
  TICKET_REPLAY_DETECTED: {
    status: 409,
    title: 'Ticket replay detected',
    slug: 'ticket-replay-detected',
  },
  PARTICIPANT_NOT_REGISTERED: {
    status: 409,
    title: 'Participant not registered',
    slug: 'participant-not-registered',
  },
  SESSION_ACCESS_DENIED: {
    status: 403,
    title: 'Session access denied',
    slug: 'session-access-denied',
  },
  SCANNER_NOT_ASSIGNED: {
    status: 403,
    title: 'Scanner not assigned',
    slug: 'scanner-not-assigned',
  },
  INVALID_STATE_TRANSITION: {
    status: 409,
    title: 'Invalid state transition',
    slug: 'invalid-state-transition',
  },
  QUOTA_EXCEEDED: {
    status: 409,
    title: 'Quota exceeded',
    slug: 'quota-exceeded',
  },
} as const satisfies Record<
  string,
  { status: number; title: string; slug: string }
>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

const ERRORS_BASE_URI = 'https://errors.eventini.com';

export function errorTypeUri(code: ErrorCode): string {
  return `${ERRORS_BASE_URI}/${ERROR_CATALOG[code].slug}`;
}

/**
 * Best-effort fallback for exceptions that never went through `AppException`
 * — a route Nest itself rejects before a controller runs (unmatched path,
 * malformed JSON body) has no catalogue code of its own. Keyed by the HTTP
 * status Nest already decided; anything not listed falls back to
 * `INTERNAL_ERROR` in the caller.
 */
export const DEFAULT_CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  400: 'VALIDATION_ERROR',
  401: 'AUTHENTICATION_REQUIRED',
  403: 'AUTH_PERMISSION_DENIED',
  404: 'RESOURCE_NOT_FOUND',
  409: 'RESOURCE_ALREADY_EXISTS',
  412: 'PRECONDITION_FAILED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  428: 'PRECONDITION_REQUIRED',
  429: 'RATE_LIMIT_EXCEEDED',
  503: 'DEPENDENCY_UNAVAILABLE',
};
