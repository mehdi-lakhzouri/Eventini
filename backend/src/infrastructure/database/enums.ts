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
};
