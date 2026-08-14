import {
  EVENT_ASSIGNMENT_TYPES,
  ROLE_SCOPES,
  type RoleScope,
} from '../../src/infrastructure/database/enums';

/**
 * The authorization reference data — sprint-03 EVT-017.
 *
 * `permissions`, `roles` and `role_permissions` are reference data rather
 * than business data (MIGRATION_STRATEGY.md §8.1): they ship with the code
 * and are applied by upsert, never written at runtime. Keeping the catalogue
 * in one file means the seed scripts contain mechanism and this contains
 * policy, so a permission change is reviewed as a data change rather than
 * buried in procedural code.
 */

export interface PermissionDefinition {
  readonly code: string;
  readonly resource: string;
  readonly action: string;
  readonly description: string;
}

/**
 * The 30 codes of DATABASE_SCHEMA.md §5.4, in `resource.action` form,
 * lowercase, snake_case for compound actions.
 */
export const PERMISSIONS: readonly PermissionDefinition[] = [
  // Organizations
  {
    code: 'organizations.read',
    resource: 'organizations',
    action: 'read',
    description: 'View the organization profile and settings.',
  },
  {
    code: 'organizations.manage',
    resource: 'organizations',
    action: 'manage',
    description: 'Change the organization profile and its permitted settings.',
  },

  // Users and membership
  {
    code: 'users.read',
    resource: 'users',
    action: 'read',
    description: 'List and view members of the organization.',
  },
  {
    code: 'users.invite',
    resource: 'users',
    action: 'invite',
    description: 'Invite a person to join the organization.',
  },
  {
    code: 'users.manage_roles',
    resource: 'users',
    action: 'manage_roles',
    description: 'Grant or revoke organization roles on a membership.',
  },

  // Authentication sessions
  {
    code: 'sessions.read',
    resource: 'sessions',
    action: 'read',
    description: 'View active sessions of the organization members.',
  },
  {
    code: 'sessions.revoke',
    resource: 'sessions',
    action: 'revoke',
    description: 'Revoke a session belonging to an organization member.',
  },

  // Events
  {
    code: 'events.read',
    resource: 'events',
    action: 'read',
    description: 'View events and their configuration.',
  },
  {
    code: 'events.create',
    resource: 'events',
    action: 'create',
    description: 'Create a new event.',
  },
  {
    code: 'events.update',
    resource: 'events',
    action: 'update',
    description: 'Change an existing event.',
  },
  {
    code: 'events.activate',
    resource: 'events',
    action: 'activate',
    description: 'Move an event from DRAFT to ACTIVE.',
  },
  {
    code: 'events.cancel',
    resource: 'events',
    action: 'cancel',
    description: 'Cancel an event.',
  },
  {
    code: 'event_sessions.manage',
    resource: 'event_sessions',
    action: 'manage',
    description: 'Create, change, open and close event sessions.',
  },

  // Participants
  {
    code: 'participants.read',
    resource: 'participants',
    action: 'read',
    description: 'View participants of the organization.',
  },
  {
    code: 'participants.import',
    resource: 'participants',
    action: 'import',
    description: 'Bulk-import participants.',
  },
  {
    code: 'participants.export',
    resource: 'participants',
    action: 'export',
    description: 'Export participant data.',
  },

  // Registrations
  {
    code: 'registrations.read',
    resource: 'registrations',
    action: 'read',
    description: 'View registrations and their session access.',
  },
  {
    code: 'registrations.manage',
    resource: 'registrations',
    action: 'manage',
    description: 'Create, change and cancel registrations.',
  },

  // Tickets
  {
    code: 'tickets.issue',
    resource: 'tickets',
    action: 'issue',
    description: 'Issue a ticket to a registration.',
  },
  {
    code: 'tickets.revoke',
    resource: 'tickets',
    action: 'revoke',
    description: 'Revoke an issued ticket.',
  },

  // Scanners
  {
    code: 'scanners.manage',
    resource: 'scanners',
    action: 'manage',
    description: 'Register, rename and revoke scanner devices.',
  },
  {
    code: 'scanners.assign',
    resource: 'scanners',
    action: 'assign',
    description: 'Assign a scanner device to an event or session.',
  },

  // Attendance — EVENT scope only, see ADR-0015.
  {
    code: 'attendance.check_in',
    resource: 'attendance',
    action: 'check_in',
    description: 'Record a participant arriving.',
  },
  {
    code: 'attendance.check_out',
    resource: 'attendance',
    action: 'check_out',
    description: 'Record a participant leaving.',
  },
  {
    code: 'attendance.override',
    resource: 'attendance',
    action: 'override',
    description:
      'Correct or force an attendance decision the normal rules refused.',
  },

  // Reporting
  {
    code: 'reports.read',
    resource: 'reports',
    action: 'read',
    description: 'View reports and dashboards.',
  },
  {
    code: 'reports.export',
    resource: 'reports',
    action: 'export',
    description: 'Export report data.',
  },

  // Platform — SUPER_ADMIN only.
  {
    code: 'platform.organizations.manage',
    resource: 'platform.organizations',
    action: 'manage',
    description: 'Create, activate, suspend and disable organizations.',
  },
  {
    code: 'platform.kill_switch.execute',
    resource: 'platform.kill_switch',
    action: 'execute',
    description: 'Cut access to an organization immediately.',
  },
  {
    code: 'platform.users.impersonate',
    resource: 'platform.users',
    action: 'impersonate',
    description: 'Act as another user, under audit.',
  },
];

export interface RoleDefinition {
  readonly code: string;
  readonly name: string;
  readonly scope: RoleScope;
  readonly description: string;
  /** The permission codes this role carries. */
  readonly permissions: readonly string[];
}

/**
 * The six system roles, and the role × permission matrix.
 *
 * ## This matrix is DERIVED, not quoted
 *
 * MIGRATION_STRATEGY.md §8.1 names the six roles and calls for "la matrice
 * rôle × permission" without stating it, so the assignments below are read
 * off the responsibilities in EVENTINI_PROJECT_CONTEXT.md §6.1–6.3 plus
 * ADR-0015. Each non-obvious call is justified inline. This is the part of
 * the ticket most worth a human review, because a wrong cell here is a
 * silent over-grant.
 *
 * `isSystem` is true for all six: §8.1 says a system role is never editable
 * through an API, so changing one means editing this file, which means a
 * reviewed pull request.
 */
export const ROLES: readonly RoleDefinition[] = [
  {
    code: 'SUPER_ADMIN',
    name: 'Platform administrator',
    scope: 'PLATFORM',
    description:
      'Administers the platform itself, not the business data inside it.',
    /**
     * Platform permissions only, plus global reporting.
     *
     * Deliberately NOT granted the organization-scoped permissions, even
     * though a platform administrator could plausibly want them: §6.1's
     * constraints end with "un super admin ne doit pas utiliser les mêmes
     * routes métier qu'un client admin sans contexte clair". Granting
     * `events.update` here would make that impossible to enforce later,
     * because the permission check would already pass. Support access to
     * tenant data goes through `platform.users.impersonate`, which is audited.
     */
    permissions: [
      'platform.organizations.manage',
      'platform.kill_switch.execute',
      'platform.users.impersonate',
      'reports.read',
    ],
  },
  {
    code: 'CLIENT_ADMIN',
    name: 'Organization administrator',
    scope: 'ORGANIZATION',
    description: 'Administers one organization and its events.',
    /**
     * Everything in §6.2's responsibilities.
     *
     * Deliberately NOT granted any `attendance.*`: ADR-0015 states those are
     * always EVENT-scoped and never granted by an organization role. An
     * administrator who needs to check people in receives an event
     * assignment, which is visible, scoped and revocable — unlike an
     * organization-wide grant.
     */
    permissions: [
      'organizations.read',
      'organizations.manage',
      'users.read',
      'users.invite',
      'users.manage_roles',
      'sessions.read',
      'sessions.revoke',
      'events.read',
      'events.create',
      'events.update',
      'events.activate',
      'events.cancel',
      'event_sessions.manage',
      'participants.read',
      'participants.import',
      'participants.export',
      'registrations.read',
      'registrations.manage',
      'tickets.issue',
      'tickets.revoke',
      'scanners.manage',
      'scanners.assign',
      'reports.read',
      'reports.export',
    ],
  },
  {
    code: 'EVENT_ADMIN',
    name: 'Event administrator',
    scope: 'EVENT',
    description: 'Runs one event, without organization-wide authority.',
    /**
     * No `events.create`: you cannot be the administrator of an event that
     * does not exist yet, so creation stays organization-scoped.
     *
     * Carries `attendance.override` — correcting a mistaken check-in is a
     * supervisory act at the event, which is exactly this role.
     */
    permissions: [
      'events.read',
      'events.update',
      'events.activate',
      'events.cancel',
      'event_sessions.manage',
      'registrations.read',
      'registrations.manage',
      'tickets.issue',
      'tickets.revoke',
      'scanners.assign',
      'attendance.check_in',
      'attendance.check_out',
      'attendance.override',
      'reports.read',
    ],
  },
  {
    code: 'SCANNER',
    name: 'Scanner operator',
    scope: 'EVENT',
    description: 'Performs check-in and check-out on an assigned perimeter.',
    /**
     * EVENT scope, not ORGANIZATION — ADR-0015, resolving C-17.
     *
     * `registrations.read` is included because §6.3 requires the operator to
     * "consulter le résultat de validation": without it a scan could be
     * accepted but not explained, and the operator could not tell a valid
     * ticket from an unknown one. It is the narrowest read that makes the
     * role function.
     *
     * `attendance.override` is deliberately absent. Overriding is how a
     * refused scan gets forced through, and §6.3's constraints are explicit
     * that a scanner performs no free modification. Someone who needs to
     * override holds EVENT_ADMIN.
     */
    permissions: [
      'attendance.check_in',
      'attendance.check_out',
      'registrations.read',
    ],
  },
  {
    code: 'SESSION_MANAGER',
    name: 'Session manager',
    scope: 'EVENT',
    description: 'Opens, closes and configures the sessions of one event.',
    permissions: ['events.read', 'event_sessions.manage', 'registrations.read'],
  },
  {
    code: 'REPORT_VIEWER',
    name: 'Report viewer',
    scope: 'EVENT',
    description: 'Reads and exports reporting for one event, and nothing else.',
    permissions: [
      'events.read',
      'registrations.read',
      'reports.read',
      'reports.export',
    ],
  },
];

/**
 * Every EVENT-scoped role code must exist as an `assignment_type` value, and
 * vice versa: ENTITY_RELATIONSHIPS.md §4.4 resolves event permissions by
 * joining `event_user_assignments.assignment_type` against `roles.code` where
 * `roles.scope = 'EVENT'`. A mismatch grants nothing, silently — the worst
 * kind of authorization bug, because it looks like a working configuration.
 */
export const EVENT_SCOPED_ROLE_CODES: readonly string[] = ROLES.filter(
  (role) => role.scope === 'EVENT',
).map((role) => role.code);

export const ALL_SCOPES: readonly RoleScope[] = ROLE_SCOPES;
export const ASSIGNMENT_TYPES: readonly string[] = EVENT_ASSIGNMENT_TYPES;
