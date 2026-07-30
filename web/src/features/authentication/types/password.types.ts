/**
 * Moved out of `permission.types.ts` so that `types/` mirrors `api/`: these
 * back `password.api.ts`.
 */
export type ForgotPasswordInput = {
  email: string;
};

export type ResetPasswordInput = {
  /** Single-use, 30-minute lifetime (ADR-0009). */
  resetToken: string;
  password: string;
};
