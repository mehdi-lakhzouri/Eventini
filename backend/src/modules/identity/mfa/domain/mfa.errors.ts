export type MfaRejection =
  | 'ACCOUNT_UNKNOWN'
  | 'NO_PENDING_ENROLLMENT'
  | 'NO_ACTIVE_METHOD'
  | 'INVALID_CODE'
  | 'CHALLENGE_NOT_FOUND'
  | 'CHALLENGE_EXHAUSTED'
  | 'LAST_METHOD_REQUIRED';

export class MfaError extends Error {
  constructor(readonly rejection: MfaRejection) {
    super(`MFA operation refused: ${rejection}`);
    this.name = 'MfaError';
  }
}
