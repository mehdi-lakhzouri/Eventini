export type Permission = string;

export type MfaVerificationInput = {
  code: string;
};

export type ForgotPasswordInput = {
  email: string;
};

export type ResetPasswordInput = {
  resetToken: string;
  password: string;
};
