/**
 * The allowed values of every enum-typed column — sprint-03 EVT-014.
 *
 * These columns are TEXT with a named CHECK constraint rather than a native
 * PostgreSQL enum, because DATABASE_SCHEMA.md §2.2 forbids `CREATE TYPE …
 * AS ENUM`: a value can be added to a native enum but not removed without
 * rewriting the table, whereas a CHECK changes in an ordinary migration.
 *
 * That decision costs the type safety a Prisma `enum` would have generated,
 * so it is recovered here. This module is the single declaration of each set;
 * the migration's CHECK constraints list the same values, and
 * `enums.spec.ts` asserts the two agree by reading the migration SQL — so a
 * value added in one place and forgotten in the other fails the build rather
 * than surfacing as a constraint violation in production.
 */

export const USER_STATUSES = [
  'PENDING',
  'ACTIVE',
  'LOCKED',
  'SUSPENDED',
  'DEACTIVATED',
  'DELETED',
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const ORGANIZATION_STATUSES = [
  'ACTIVE',
  'SUSPENDED',
  'KILLED',
  'DELETED',
] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const MEMBERSHIP_STATUSES = [
  'INVITED',
  'ACTIVE',
  'SUSPENDED',
  'REVOKED',
  'EXPIRED',
  'DELETED',
] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/**
 * Where a role may be granted. The scope is what INV-09 enforces: a
 * `PLATFORM` role must never appear in `membership_role_assignments`, which
 * is the most direct privilege-escalation path in the model.
 *
 * `SCANNER` is `EVENT`-scoped, not `ORGANIZATION` — ADR-0015, resolving C-17.
 */
export const ROLE_SCOPES = ['PLATFORM', 'ORGANIZATION', 'EVENT'] as const;
export type RoleScope = (typeof ROLE_SCOPES)[number];

export const PLATFORM_ROLE_ASSIGNMENT_STATUSES = [
  'ACTIVE',
  'SUSPENDED',
  'REVOKED',
] as const;
export type PlatformRoleAssignmentStatus =
  (typeof PLATFORM_ROLE_ASSIGNMENT_STATUSES)[number];

// --- Migration 3, events domain (EVT-015) ----------------------------------

/**
 * `DRAFT → ACTIVE → EXPIRED`, and `DRAFT|ACTIVE → CANCELLED`. Nothing returns
 * from `EXPIRED` or `CANCELLED` — see `event-transitions.ts`, which is the
 * single place that decides.
 */
export const EVENT_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'EXPIRED',
  'CANCELLED',
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_SESSION_TYPES = [
  'DAY',
  'PANEL',
  'WORKSHOP',
  'ZONE',
  'SLOT',
] as const;
export type EventSessionType = (typeof EVENT_SESSION_TYPES)[number];

export const EVENT_SESSION_STATUSES = ['SCHEDULED', 'OPEN', 'CLOSED'] as const;
export type EventSessionStatus = (typeof EVENT_SESSION_STATUSES)[number];

/**
 * These are not free text: ENTITY_RELATIONSHIPS.md §4.4 resolves event
 * permissions by joining `assignment_type` against `roles.code` where
 * `roles.scope = 'EVENT'`. A value here with no matching role silently grants
 * nothing, so the two sets have to stay aligned — the seed (EVT-017) creates
 * exactly these role codes.
 */
export const EVENT_ASSIGNMENT_TYPES = [
  'EVENT_ADMIN',
  'SCANNER',
  'REPORT_VIEWER',
  'SESSION_MANAGER',
] as const;
export type EventAssignmentType = (typeof EVENT_ASSIGNMENT_TYPES)[number];

export const EVENT_ASSIGNMENT_STATUSES = [
  'ACTIVE',
  'SUSPENDED',
  'REVOKED',
] as const;
export type EventAssignmentStatus = (typeof EVENT_ASSIGNMENT_STATUSES)[number];

// --- Migration 8, audit and security (EVT-016) -----------------------------

/**
 * The security event catalogue — AUTHENTICATION_AUTHORIZATION.md §8.
 *
 * This list resolves contradiction **C-11**: the corpus carried four
 * competing catalogues, and Document D required recording types the narrowest
 * enum could not store. This is their union, grouped by domain in the order
 * the source table uses.
 *
 * Distinct from `LOG_EVENT_CODES` in `infrastructure/logging`, and
 * deliberately so — §10 of the logging spec states the two namespaces are not
 * synchronised. A code may appear in both (`LOGIN_FAILED`, `ROLE_CHANGED`)
 * with no relationship: one is a line in a log store with weeks of retention,
 * the other a row in PostgreSQL kept for twelve months and treated as
 * evidence.
 */
export const SECURITY_EVENT_TYPES = [
  // Authentication
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'ACCOUNT_LOCKED',

  // MFA
  'MFA_CHALLENGE_CREATED',
  'MFA_SUCCEEDED',
  'MFA_FAILED',
  'MFA_ENABLED',
  'MFA_DISABLED',

  // Sessions
  'SESSION_CREATED',
  'SESSION_REFRESHED',
  'SESSION_REVOKED',
  'ALL_SESSIONS_REVOKED',
  'SESSION_COMPROMISED',
  'REFRESH_TOKEN_REUSE_DETECTED',

  // Passwords
  'PASSWORD_CHANGED',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET_COMPLETED',

  // Authorization
  'ROLE_CHANGED',
  'ROLE_ESCALATION_ATTEMPTED',
  'MEMBERSHIP_REVOKED',
  'TENANT_ACCESS_DENIED',
  'REAUTHENTICATION_REQUIRED',

  // Web
  'CSRF_VALIDATION_FAILED',
  'ORIGIN_VALIDATION_FAILED',
  'RATE_LIMIT_EXCEEDED',

  // Organization
  'ORGANIZATION_SUSPENDED',
  'ORGANIZATION_KILL_SWITCH_EXECUTED',
  'ORGANIZATION_CONTEXT_SWITCHED',

  // Tickets and scanners
  'TICKET_SIGNATURE_INVALID',
  'TICKET_REPLAY_DETECTED',
  'SCANNER_DEVICE_REVOKED',

  // System
  'IDEMPOTENCY_CONFLICT_DETECTED',
  'UNSCOPED_QUERY_EXECUTED',
  'SIGNING_KEY_ROTATED',
] as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

/** Not enumerated in Document A; fixed by DATABASE_SCHEMA.md §8.1. */
export const SECURITY_EVENT_SEVERITIES = [
  'INFO',
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const;
export type SecurityEventSeverity = (typeof SECURITY_EVENT_SEVERITIES)[number];

/**
 * `DENIED` is distinct from `FAILURE` on purpose: a failure is an attempt
 * that did not work, a denial is one that was refused by policy. Collapsing
 * them would make "how many people were blocked by authorization" unanswerable.
 */
export const SECURITY_EVENT_RESULTS = ['SUCCESS', 'FAILURE', 'DENIED'] as const;
export type SecurityEventResult = (typeof SECURITY_EVENT_RESULTS)[number];

/**
 * Maps each CHECK constraint to the values it permits.
 *
 * Keyed by constraint name so the spec can look each one up in the migration
 * SQL directly, rather than re-deriving the name and getting it subtly wrong.
 */
export const CHECK_CONSTRAINT_VALUES: Readonly<
  Record<string, readonly string[]>
> = {
  ck_users_status: USER_STATUSES,
  ck_organizations_status: ORGANIZATION_STATUSES,
  ck_memberships_status: MEMBERSHIP_STATUSES,
  ck_roles_scope: ROLE_SCOPES,
  ck_platform_role_assignments_status: PLATFORM_ROLE_ASSIGNMENT_STATUSES,
  ck_events_status: EVENT_STATUSES,
  ck_event_sessions_type: EVENT_SESSION_TYPES,
  ck_event_sessions_status: EVENT_SESSION_STATUSES,
  ck_event_assignments_type: EVENT_ASSIGNMENT_TYPES,
  ck_event_assignments_status: EVENT_ASSIGNMENT_STATUSES,
  ck_security_events_type: SECURITY_EVENT_TYPES,
  ck_security_events_severity: SECURITY_EVENT_SEVERITIES,
  ck_security_events_result: SECURITY_EVENT_RESULTS,
};
