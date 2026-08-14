import {
  resolveOrganization,
  type ActiveMembership,
} from './organization-resolution';

function membership(
  id: string,
  organizationId: string,
  overrides: Partial<ActiveMembership> = {},
): ActiveMembership {
  return {
    membershipId: id,
    organizationId,
    organizationActive: true,
    organizationEnabled: true,
    ...overrides,
  };
}

describe('resolveOrganization', () => {
  it('activates the only usable membership', () => {
    expect(resolveOrganization([membership('mbr_1', 'org_1')], false)).toEqual({
      kind: 'TENANT',
      organizationId: 'org_1',
      membershipId: 'mbr_1',
    });
  });

  /**
   * The case Document B ignored. Choosing one would land the user in a tenant
   * they did not pick, and every action afterwards is attributed there.
   */
  it('chooses nothing when several are usable', () => {
    expect(
      resolveOrganization(
        [membership('mbr_1', 'org_1'), membership('mbr_2', 'org_2')],
        false,
      ),
    ).toEqual({ kind: 'AMBIGUOUS' });
  });

  it('gives a platform session when there is no membership but a platform role', () => {
    expect(resolveOrganization([], true)).toEqual({ kind: 'PLATFORM' });
  });

  it('denies when there is neither', () => {
    expect(resolveOrganization([], false)).toEqual({ kind: 'DENIED' });
  });

  describe('unusable organizations are filtered before counting', () => {
    it.each([
      ['suspended', { organizationActive: false }],
      ['disabled', { organizationEnabled: false }],
    ])('ignores a %s organization', (_label, broken) => {
      expect(
        resolveOrganization(
          [membership('mbr_1', 'org_1'), membership('mbr_2', 'org_2', broken)],
          false,
        ),
      ).toEqual({
        kind: 'TENANT',
        organizationId: 'org_1',
        membershipId: 'mbr_1',
      });
    });

    /**
     * Belonging somewhere unusable is a different answer from belonging
     * nowhere: §5.1 answers the first generically and the second with a 403.
     * Telling a caller "your organization is suspended" is a fact about an
     * account that may not be theirs.
     */
    it('reports an unusable organization separately from no access', () => {
      expect(
        resolveOrganization(
          [membership('mbr_1', 'org_1', { organizationActive: false })],
          false,
        ),
      ).toEqual({ kind: 'ORGANIZATION_UNAVAILABLE' });

      expect(resolveOrganization([], false)).toEqual({ kind: 'DENIED' });
    });

    it('falls back to a platform session when every organization is unusable', () => {
      expect(
        resolveOrganization(
          [membership('mbr_1', 'org_1', { organizationEnabled: false })],
          true,
        ),
      ).toEqual({ kind: 'PLATFORM' });
    });
  });

  /** A platform role never overrides a definite tenant membership. */
  it('prefers the single membership over the platform role', () => {
    expect(
      resolveOrganization([membership('mbr_1', 'org_1')], true),
    ).toMatchObject({ kind: 'TENANT' });
  });
});
