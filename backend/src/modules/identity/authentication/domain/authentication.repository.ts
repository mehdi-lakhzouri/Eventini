import type { ActiveMembership } from './organization-resolution';

export interface AuthenticationCandidate {
  readonly userId: string;
  readonly status: string;
  readonly userVersion: number;
  /** Null when the account has no credential yet — a bootstrap admin, say. */
  readonly passwordHash: string | null;
  readonly passwordVersion: number;
  readonly hasActiveMfa: boolean;
  readonly hasPlatformRole: boolean;
  /** Step 10 requires MFA of a `SUPER_ADMIN` regardless of enrolment. */
  readonly isSuperAdmin: boolean;
  readonly memberships: readonly ActiveMembership[];
}

export abstract class AuthenticationRepository {
  /**
   * One query for everything steps 6 to 13 need. Splitting it would make the
   * unknown-account path measurably cheaper than the known one, which is the
   * timing leak step 7 exists to close.
   */
  abstract findCandidateByEmail(
    normalizedEmail: string,
  ): Promise<AuthenticationCandidate | null>;

  /**
   * Re-reads the account when an MFA challenge is answered.
   *
   * The challenge lives five minutes, and nothing stops an account being
   * suspended or a membership revoked inside that window. Completing the login
   * from state captured at password time would honour privileges that no
   * longer exist, so the decision is taken again on fresh rows.
   */
  abstract findCandidateById(
    userId: string,
  ): Promise<AuthenticationCandidate | null>;
}
