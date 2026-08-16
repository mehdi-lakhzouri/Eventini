/**
 * Moved out of `permission.types.ts`, where it had nothing to do with
 * permissions. The `types/` files now mirror the `api/` files one for one, so
 * the type backing `mfa.api.ts` is where you would look for it.
 */
export type MfaVerificationInput = {
  /** TOTP à six chiffres ou code de secours ; le backend essaie les deux. */
  code: string;
};
