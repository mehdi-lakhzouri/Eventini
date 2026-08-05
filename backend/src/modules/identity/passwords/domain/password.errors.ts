export type PasswordRejection =
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_ALREADY_USED'
  | 'WRONG_CURRENT_PASSWORD';

export class PasswordFlowError extends Error {
  constructor(readonly rejection: PasswordRejection) {
    super(`Password operation refused: ${rejection}`);
    this.name = 'PasswordFlowError';
  }
}
