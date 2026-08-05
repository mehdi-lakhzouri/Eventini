export interface MfaMethodRecord {
  readonly methodId: string;
  readonly encryptedSecret: string;
}

export interface RecoveryCodeRecord {
  readonly codeId: string;
  readonly codeHash: string;
}

export abstract class MfaRepository {
  /**
   * The label an authenticator app shows beside the code — the account's
   * email. Null when the account is gone, which the enrolment path treats as
   * a refusal rather than labelling a QR code with an empty string.
   */
  abstract findAccountName(userId: string): Promise<string | null>;

  abstract findActiveMethod(userId: string): Promise<MfaMethodRecord | null>;

  abstract findPendingMethod(userId: string): Promise<MfaMethodRecord | null>;

  /** Replaces any PENDING enrolment; an ACTIVE one is left alone (C-28). */
  abstract startEnrollment(input: {
    readonly userId: string;
    readonly encryptedSecret: string;
    readonly now: Date;
  }): Promise<string>;

  /**
   * Activates the pending method and writes a fresh batch of recovery codes,
   * in one transaction. Any previously active method is disabled in the same
   * statement, so a device swap never leaves two live methods.
   */
  abstract activate(input: {
    readonly userId: string;
    readonly methodId: string;
    readonly codeHashes: readonly string[];
    readonly now: Date;
  }): Promise<void>;

  abstract listAvailableRecoveryCodes(
    methodId: string,
  ): Promise<RecoveryCodeRecord[]>;

  abstract consumeRecoveryCode(input: {
    readonly codeId: string;
    readonly now: Date;
  }): Promise<boolean>;

  /** Old batch revoked and new batch written together, never separately. */
  abstract replaceRecoveryCodes(input: {
    readonly methodId: string;
    readonly codeHashes: readonly string[];
    readonly now: Date;
  }): Promise<void>;

  abstract disable(input: {
    readonly userId: string;
    readonly methodId: string;
    readonly now: Date;
  }): Promise<boolean>;
}
