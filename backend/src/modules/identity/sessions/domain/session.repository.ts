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
}
