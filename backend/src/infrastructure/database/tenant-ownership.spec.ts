import { Prisma } from './prisma/generated/client';
import {
  TENANT_OWNED_MODELS,
  TENANT_OWNERSHIP,
  ownershipOf,
  requiresOrganizationScope,
  scopeRuleFor,
} from './tenant-ownership';

/**
 * The classification is only useful if it is complete, so completeness is
 * what this asserts — against Prisma's own generated model list rather than a
 * copy of it, so a model added by a migration shows up here without anyone
 * remembering to add it.
 */
describe('the registry covers every model', () => {
  const generatedModels = Object.keys(Prisma.ModelName);

  it.each(generatedModels)('classifies %s', (model) => {
    expect(ownershipOf(model)).toBeDefined();
  });

  /**
   * The other direction. An entry left behind after a model is renamed would
   * silently exempt nothing and protect nothing, and would read as though it
   * still did both.
   */
  it('has no entry for a model that no longer exists', () => {
    for (const model of Object.keys(TENANT_OWNERSHIP)) {
      expect(generatedModels).toContain(model);
    }
  });
});

describe('requiresOrganizationScope', () => {
  it.each(['Event', 'OrganizationMembership'])(
    'guards the ORGANIZATION-owned model %s',
    (model) => {
      expect(requiresOrganizationScope(model)).toBe(true);
    },
  );

  /**
   * The table ADR-0003 §1 says cannot exist. DATABASE_SCHEMA.md §5.6
   * classifies it `ORGANIZATION-OWNED` "(via le membership)" and lists no
   * `organization_id`; EVT-014 built what §5.6 specified. Exempting it would
   * leave role grants — the most direct privilege-escalation surface in the
   * schema — unguarded, so it stays guarded through the relation.
   */
  it('guards MembershipRoleAssignment through its membership', () => {
    expect(requiresOrganizationScope('MembershipRoleAssignment')).toBe(true);
    expect(scopeRuleFor('MembershipRoleAssignment')).toEqual({
      via: 'membership',
    });
  });

  it('asks for the plain column everywhere else', () => {
    expect(scopeRuleFor('Event')).toEqual({});
    expect(scopeRuleFor('EventSession')).toEqual({});
  });

  it('returns no rule for an exempt model', () => {
    expect(scopeRuleFor('Role')).toBeUndefined();
    expect(scopeRuleFor('User')).toBeUndefined();
    expect(scopeRuleFor('AuditLog')).toBeUndefined();
  });

  /**
   * §2.4 denormalises `organization_id` onto EVENT-owned tables specifically
   * so the guard applies to them without a join. If these ever stopped being
   * guarded, that column would have no purpose.
   */
  it.each(['EventSession', 'EventUserAssignment'])(
    'guards the EVENT-owned model %s',
    (model) => {
      expect(requiresOrganizationScope(model)).toBe(true);
    },
  );

  it.each(['User', 'UserCredential', 'Organization', 'PlatformRoleAssignment'])(
    'exempts the PLATFORM model %s',
    (model) => {
      expect(requiresOrganizationScope(model)).toBe(false);
    },
  );

  it.each(['Role', 'Permission', 'RolePermission'])(
    'exempts the GLOBAL-REFERENCE model %s',
    (model) => {
      expect(requiresOrganizationScope(model)).toBe(false);
    },
  );

  /** The documented weak spot — nullable `organization_id`. */
  it.each(['SecurityEvent', 'AuditLog'])(
    'exempts the TENANT_OPTIONAL model %s',
    (model) => {
      expect(requiresOrganizationScope(model)).toBe(false);
    },
  );

  /**
   * The inversion of ADR-0003's allow-list, and the reason for it. Under an
   * allow-list this returns `false` and the new model's queries all work,
   * unprotected, until someone notices. Here it returns `true` and the first
   * query fails with the model named.
   */
  it('guards a model nobody has classified', () => {
    expect(requiresOrganizationScope('Participant')).toBe(true);
    expect(requiresOrganizationScope('Ticket')).toBe(true);
    expect(requiresOrganizationScope('')).toBe(true);
  });

  /**
   * `ownershipOf` walks an object literal, so a lookup of `constructor` or
   * `toString` would find `Object.prototype`'s and report a model as
   * classified when it is not. The check is `hasOwnProperty` for that reason.
   */
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'is not fooled by the prototype property %s',
    (name) => {
      expect(ownershipOf(name)).toBeUndefined();
      expect(requiresOrganizationScope(name)).toBe(true);
    },
  );
});

describe('TENANT_OWNED_MODELS', () => {
  it('is exactly the set of guarded models', () => {
    expect([...TENANT_OWNED_MODELS].sort()).toEqual(
      [
        'Event',
        'EventSession',
        'EventUserAssignment',
        'MembershipRoleAssignment',
        'OrganizationMembership',
      ].sort(),
    );
  });
});
