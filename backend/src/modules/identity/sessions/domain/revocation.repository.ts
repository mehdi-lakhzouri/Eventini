import type {
  AuthenticationLevel,
  SessionClientType,
} from '../../../../infrastructure/database/enums';

export interface CallerSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly userVersion: number;
  readonly userStatus: string;
  readonly organizationId: string | null;
  readonly membershipId: string | null;
  readonly clientType: SessionClientType;
  readonly authenticationLevel: AuthenticationLevel;
  readonly status: string;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

export interface SessionSummary {
  readonly sessionId: string;
  readonly clientType: string;
  readonly deviceName: string | null;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly current: boolean;
}

export abstract class RevocationRepository {
  /** Steps 2 and 3 of the chain read this; step 1 reads the token. */
  abstract findCallerSession(sessionId: string): Promise<CallerSession | null>;

  abstract listActiveSessions(userId: string): Promise<SessionSummary[]>;

  /** Revokes one session and its whole token family. Idempotent. */
  abstract revokeSession(input: {
    readonly sessionId: string;
    readonly userId: string;
    readonly revokedBy: string;
    readonly reason: string;
    readonly now: Date;
  }): Promise<boolean>;

  /**
   * Revokes every active session of a user and increments `users.version`.
   *
   * The increment is what makes this immediate: access tokens carry the
   * version as `ver`, so every one already in circulation stops matching
   * without waiting for its own expiry.
   */
  abstract revokeAllSessions(input: {
    readonly userId: string;
    readonly revokedBy: string;
    readonly reason: string;
    readonly now: Date;
  }): Promise<number>;
}
