/**
 * Why a login was refused. Internal only.
 *
 * §5.1 answers `AUTH_INVALID_CREDENTIALS` for every one of these except
 * `NO_ACCESS`: an unknown account, a wrong password, a suspended user and a
 * locked account are indistinguishable to the caller, in body and in timing.
 * Distinguishing them turns the login endpoint into an account-existence
 * oracle and a status oracle.
 *
 * `AUTH_ACCOUNT_LOCKED` deliberately does not exist in the error catalogue.
 */
export type LoginRejection =
  | 'UNKNOWN_ACCOUNT'
  | 'BAD_PASSWORD'
  | 'NO_CREDENTIAL'
  | 'USER_NOT_ACTIVE'
  | 'ORGANIZATION_UNAVAILABLE'
  | 'NO_ACCESS';

export class AuthenticationError extends Error {
  constructor(readonly rejection: LoginRejection) {
    super(`Login refused: ${rejection}`);
    this.name = 'AuthenticationError';
  }
}

/** Only `NO_ACCESS` earns its own response; everything else is generic. */
export function isGenericRejection(rejection: LoginRejection): boolean {
  return rejection !== 'NO_ACCESS';
}
