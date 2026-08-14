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

/**
 * What `GET /auth/me` shows the caller about themselves.
 *
 * Deliberately not `AuthenticationCandidate`: that shape carries a password
 * hash and every membership, because login needs it to decide something. A
 * profile read decides nothing — it has no reason to pull a credential into
 * memory at all, let alone hand it to whatever renders the response.
 */
export interface CurrentUserProfile {
  readonly userId: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly displayName: string | null;
  readonly status: string;
  readonly emailVerifiedAt: Date | null;
  readonly lastLoginAt: Date | null;
  readonly hasActiveMfa: boolean;
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

  /**
   * The profile read, keyed by the same id as `findCandidateById` but
   * deliberately a different query. That one exists to decide an
   * authentication outcome and must see a password hash; this one renders a
   * response and must not.
   */
  abstract findProfileById(userId: string): Promise<CurrentUserProfile | null>;
}
