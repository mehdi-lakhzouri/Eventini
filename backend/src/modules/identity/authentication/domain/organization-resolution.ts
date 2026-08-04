export interface ActiveMembership {
  readonly membershipId: string;
  readonly organizationId: string;
  /** Both must hold, or the organization cannot host a session (step 12). */
  readonly organizationActive: boolean;
  readonly organizationEnabled: boolean;
}

export type OrganizationResolution =
  /** Exactly one usable membership: it becomes the active organization. */
  | { kind: 'TENANT'; organizationId: string; membershipId: string }
  /**
   * Several. The session is created with no active organization and the
   * client calls `POST /organizations/{id}/activation`.
   */
  | { kind: 'AMBIGUOUS' }
  /** No membership, but a platform role: `organization_id IS NULL`. */
  | { kind: 'PLATFORM' }
  /**
   * The user belongs somewhere, but every one of those organizations is
   * suspended or disabled. Answered generically, per §5.1's negative tests —
   * "your organization is suspended" is a fact about someone else's account.
   */
  | { kind: 'ORGANIZATION_UNAVAILABLE' }
  /** No membership at all and no platform role: nothing to sign in to. */
  | { kind: 'DENIED' };

/**
 * Step 11 of §5.1, the case Document B did not cover.
 *
 * No organization is ever chosen on the user's behalf. Picking "the first
 * one" would mean a login silently lands in a tenant the user did not intend,
 * and every subsequent action is attributed there.
 *
 * Unusable organizations are filtered out *before* the count, so a user with
 * one live membership and one suspended one still gets a definite answer
 * rather than an ambiguous one.
 */
export function resolveOrganization(
  memberships: readonly ActiveMembership[],
  hasPlatformRole: boolean,
): OrganizationResolution {
  const usable = memberships.filter(
    (membership) =>
      membership.organizationActive && membership.organizationEnabled,
  );

  if (usable.length === 1) {
    const only = usable[0] as ActiveMembership;

    return {
      kind: 'TENANT',
      organizationId: only.organizationId,
      membershipId: only.membershipId,
    };
  }

  if (usable.length > 1) {
    return { kind: 'AMBIGUOUS' };
  }

  if (hasPlatformRole) {
    return { kind: 'PLATFORM' };
  }

  // Having memberships that are all unusable is a different answer from
  // having none: §5.1 wants the first generic and the second a 403.
  return memberships.length > 0
    ? { kind: 'ORGANIZATION_UNAVAILABLE' }
    : { kind: 'DENIED' };
}
