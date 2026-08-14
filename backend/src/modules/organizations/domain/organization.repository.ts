/** One organization the caller can actually work in. */
export interface MembershipSummary {
  readonly organizationId: string;
  readonly membershipId: string;
  readonly name: string;
  readonly slug: string;
  /** True when this is the session's current organization. */
  readonly active: boolean;
}

/**
 * Why an activation cannot proceed. The controller renders every one of these
 * as the same `403`: distinguishing "no membership" from "organization
 * suspended" would let a caller enumerate which organization ids exist.
 */
export type ActivationRefusal = 'NO_MEMBERSHIP' | 'ORGANIZATION_UNAVAILABLE';

export interface ActivationTarget {
  readonly organizationId: string;
  readonly membershipId: string;
}

export abstract class OrganizationRepository {
  /**
   * Keyed on the user, never on a client-supplied organization id — the list
   * is derived from memberships, so it cannot be made to include an
   * organization the caller has no membership in.
   */
  abstract listForUser(
    userId: string,
    currentOrganizationId: string | null,
  ): Promise<MembershipSummary[]>;

  /**
   * Resolves the membership for an activation, or the reason it is refused.
   *
   * The organization id arrives from the path, and this is the one place it is
   * allowed to: it is used to *look up a membership belonging to the caller*,
   * so a forged id finds nothing rather than scoping a query.
   */
  abstract findActivationTarget(
    userId: string,
    organizationId: string,
  ): Promise<ActivationTarget | ActivationRefusal>;
}
