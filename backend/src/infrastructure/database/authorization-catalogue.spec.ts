import {
  ASSIGNMENT_TYPES,
  EVENT_SCOPED_ROLE_CODES,
  PERMISSIONS,
  ROLES,
} from '../../../prisma/seed/authorization-catalogue';
import { ROLE_SCOPES } from './enums';

describe('permission catalogue', () => {
  it('carries the 30 codes DATABASE_SCHEMA.md §5.4 lists', () => {
    expect(PERMISSIONS).toHaveLength(30);
  });

  it('has no duplicate code', () => {
    const codes = PERMISSIONS.map((permission) => permission.code);

    expect(new Set(codes).size).toBe(codes.length);
  });

  it('follows the resource.action convention, lowercase and snake_case', () => {
    for (const permission of PERMISSIONS) {
      expect(permission.code).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
      expect(permission.code).toBe(
        `${permission.resource}.${permission.action}`,
      );
    }
  });

  it('describes every permission, so a consent screen is not guesswork', () => {
    for (const permission of PERMISSIONS) {
      expect(permission.description.length).toBeGreaterThan(10);
    }
  });
});

describe('role catalogue', () => {
  const codes = ROLES.map((role) => role.code);

  it('defines the six system roles MIGRATION_STRATEGY.md §8.1 names', () => {
    expect(codes.sort()).toEqual(
      [
        'CLIENT_ADMIN',
        'EVENT_ADMIN',
        'REPORT_VIEWER',
        'SCANNER',
        'SESSION_MANAGER',
        'SUPER_ADMIN',
      ].sort(),
    );
  });

  it('gives every role a declared scope', () => {
    for (const role of ROLES) {
      expect(ROLE_SCOPES).toContain(role.scope);
    }
  });

  /** The scopes ADR-0015 fixes, resolving C-17. */
  it.each([
    ['SUPER_ADMIN', 'PLATFORM'],
    ['CLIENT_ADMIN', 'ORGANIZATION'],
    ['SCANNER', 'EVENT'],
  ])('scopes %s to %s', (code, scope) => {
    expect(ROLES.find((role) => role.code === code)?.scope).toBe(scope);
  });

  it('grants only permissions that exist in the catalogue', () => {
    const known = new Set(PERMISSIONS.map((permission) => permission.code));

    for (const role of ROLES) {
      for (const code of role.permissions) {
        expect(known.has(code)).toBe(true);
      }
    }
  });

  it('never lists the same permission twice on one role', () => {
    for (const role of ROLES) {
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
    }
  });
});

/**
 * ENTITY_RELATIONSHIPS.md §4.4 resolves event permissions by joining
 * `event_user_assignments.assignment_type` against `roles.code` where
 * `roles.scope = 'EVENT'`. A value on one side with no counterpart on the
 * other grants nothing, silently — which looks exactly like a working
 * configuration until someone cannot do their job at a venue door.
 */
describe('EVENT-scoped roles align with assignment types', () => {
  it('has an EVENT role for every assignment type', () => {
    for (const type of ASSIGNMENT_TYPES) {
      expect(EVENT_SCOPED_ROLE_CODES).toContain(type);
    }
  });

  it('has an assignment type for every EVENT role', () => {
    for (const code of EVENT_SCOPED_ROLE_CODES) {
      expect(ASSIGNMENT_TYPES).toContain(code);
    }
  });
});

/**
 * ADR-0015: attendance permissions are always EVENT-scoped and are never
 * granted by an organization role. An administrator who needs to check people
 * in receives an event assignment — visible, scoped and revocable — rather
 * than an organization-wide grant.
 */
describe('attendance stays event-scoped (ADR-0015)', () => {
  const attendanceCodes = PERMISSIONS.filter((permission) =>
    permission.code.startsWith('attendance.'),
  ).map((permission) => permission.code);

  it.each(['SUPER_ADMIN', 'CLIENT_ADMIN'])(
    '%s carries no attendance permission',
    (roleCode) => {
      const role = ROLES.find((candidate) => candidate.code === roleCode);

      for (const code of attendanceCodes) {
        expect(role?.permissions).not.toContain(code);
      }
    },
  );

  it('grants check-in only to EVENT-scoped roles', () => {
    const holders = ROLES.filter((role) =>
      role.permissions.includes('attendance.check_in'),
    );

    expect(holders.length).toBeGreaterThan(0);
    for (const role of holders) {
      expect(role.scope).toBe('EVENT');
    }
  });

  /**
   * Overriding is how a refused scan gets forced through. §6.3 is explicit
   * that a scanner performs no free modification, so the operator role must
   * not hold it.
   */
  it('withholds override from SCANNER while granting it to EVENT_ADMIN', () => {
    const scanner = ROLES.find((role) => role.code === 'SCANNER');
    const eventAdmin = ROLES.find((role) => role.code === 'EVENT_ADMIN');

    expect(scanner?.permissions).not.toContain('attendance.override');
    expect(eventAdmin?.permissions).toContain('attendance.override');
  });
});

/**
 * §6.1: "un super admin ne doit pas utiliser les mêmes routes métier qu'un
 * client admin sans contexte clair". Granting a business permission here
 * would make that impossible to enforce later, because the check would
 * already pass.
 */
describe('platform and tenant authority stay separate (§6.1)', () => {
  const superAdmin = ROLES.find((role) => role.code === 'SUPER_ADMIN');
  const clientAdmin = ROLES.find((role) => role.code === 'CLIENT_ADMIN');

  it.each([
    'events.create',
    'events.update',
    'users.invite',
    'participants.export',
    'tickets.issue',
  ])('SUPER_ADMIN does not carry the tenant permission %s', (code) => {
    expect(superAdmin?.permissions).not.toContain(code);
  });

  it.each([
    'platform.organizations.manage',
    'platform.kill_switch.execute',
    'platform.users.impersonate',
  ])('CLIENT_ADMIN does not carry the platform permission %s', (code) => {
    expect(clientAdmin?.permissions).not.toContain(code);
  });

  it('gives the platform permissions to SUPER_ADMIN and to nobody else', () => {
    const platformCodes = PERMISSIONS.filter((permission) =>
      permission.code.startsWith('platform.'),
    ).map((permission) => permission.code);

    for (const role of ROLES) {
      if (role.code === 'SUPER_ADMIN') continue;

      for (const code of platformCodes) {
        expect(role.permissions).not.toContain(code);
      }
    }
  });
});
