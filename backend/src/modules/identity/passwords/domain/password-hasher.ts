export interface PasswordVerification {
  readonly valid: boolean;
  /** The stored hash used weaker parameters than the current profile. */
  readonly needsRehash: boolean;
}

export abstract class PasswordHasher {
  /** `user_credentials.password_version` written by `hash`. */
  abstract readonly version: number;

  abstract hash(password: string): Promise<string>;

  abstract verify(
    encodedHash: string,
    password: string,
  ): Promise<PasswordVerification>;

  /**
   * Same work as `verify` against a hash nobody knows the password to.
   * Login calls it when the account does not exist, so the response time does
   * not disclose which accounts are real.
   */
  abstract verifyDecoy(password: string): Promise<void>;
}
