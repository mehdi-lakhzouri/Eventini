import type {
  AuthenticationLevel,
  SessionClientType,
} from '../../../../infrastructure/database/enums';
import type { TransactionalClient } from '../../../../infrastructure/database/transaction.manager';

export interface NewSession {
  readonly userId: string;
  readonly organizationId: string | null;
  readonly membershipId: string | null;
  readonly clientType: SessionClientType;
  readonly authenticationLevel: AuthenticationLevel;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
  readonly requestId: string | null;
}

export interface NewRefreshToken {
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export interface CreatedSession {
  readonly sessionId: string;
  readonly tokenFamilyId: string;
  readonly refreshTokenId: string;
}

/**
 * `user_sessions` is mixed-ownership — a platform session has no organization
 * — so the tenant guard exempts it and these methods take no `TenantContext`.
 * The exemption is recorded in `tenant-ownership.ts` and in the architecture
 * spec's allow-list rather than assumed here.
 */
export abstract class SessionRepository {
  abstract createWithRefreshToken(
    tx: TransactionalClient,
    session: NewSession,
    refreshToken: NewRefreshToken,
  ): Promise<CreatedSession>;

  abstract touchLastLogin(
    tx: TransactionalClient,
    userId: string,
    at: Date,
  ): Promise<void>;

  /**
   * Retires a session that a successor has replaced, and kills its token
   * family with it — EVT-033's organization switch.
   *
   * `REPLACED` rather than `REVOKED` on purpose: both end the session, but the
   * audit trail should say whether it ended because someone signed out or
   * because the context moved. Leaving the family alive would let the holder
   * of the old refresh token rebuild a session still pointing at the previous
   * organization, which is the whole thing the rotation exists to prevent.
   *
   * Takes the transaction: the successor and this must commit together, or a
   * crash between them leaves the caller with two live sessions or none.
   */
  abstract replaceSession(
    tx: TransactionalClient,
    input: {
      readonly sessionId: string;
      readonly userId: string;
      readonly now: Date;
    },
  ): Promise<void>;
}
