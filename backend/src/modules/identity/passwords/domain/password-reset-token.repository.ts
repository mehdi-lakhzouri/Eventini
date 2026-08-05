export interface PendingResetToken {
  readonly tokenId: string;
  readonly userId: string;
  readonly expiresAt: Date;
}

export interface CredentialOwner {
  readonly userId: string;
  readonly passwordHash: string | null;
}

export abstract class PasswordResetTokenRepository {
  /** Null for an unknown or soft-deleted account. */
  abstract findActiveUserByEmail(
    normalizedEmail: string,
  ): Promise<{ userId: string } | null>;

  abstract findCredential(userId: string): Promise<CredentialOwner | null>;

  /**
   * Replaces the user's PENDING tokens and stores the new one, in one
   * transaction: a request that left an older token alive would defeat the
   * single-use rule the moment two emails were in flight.
   */
  abstract replacePending(input: {
    readonly userId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
    readonly requestedIp: string | null;
    readonly now: Date;
  }): Promise<void>;

  abstract findPendingByHash(
    tokenHash: string,
  ): Promise<PendingResetToken | null>;

  /**
   * Consumes the token and writes the new password, in one transaction.
   * Returns false when the token was consumed concurrently.
   */
  abstract consumeAndSetPassword(input: {
    readonly tokenId: string;
    readonly userId: string;
    readonly passwordHash: string;
    readonly passwordVersion: number;
    readonly now: Date;
  }): Promise<boolean>;

  abstract setPassword(input: {
    readonly userId: string;
    readonly passwordHash: string;
    readonly passwordVersion: number;
    readonly now: Date;
  }): Promise<void>;
}
