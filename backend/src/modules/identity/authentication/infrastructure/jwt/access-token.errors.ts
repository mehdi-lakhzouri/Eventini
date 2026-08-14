export type AccessTokenRejection =
  | 'MALFORMED'
  | 'UNKNOWN_KEY'
  | 'BAD_SIGNATURE'
  | 'EXPIRED'
  | 'BAD_ISSUER'
  | 'BAD_AUDIENCE'
  | 'BAD_CLAIMS';

/**
 * Why a token was refused.
 *
 * The reason stays inside the server. Every rejection is one
 * `401 AUTHENTICATION_REQUIRED` to the caller: telling them the signature was
 * valid but the audience wrong is telling them their forgery is one field away
 * from working.
 */
export class AccessTokenError extends Error {
  constructor(
    readonly rejection: AccessTokenRejection,
    detail?: string,
  ) {
    super(detail === undefined ? rejection : `${rejection}: ${detail}`);
    this.name = 'AccessTokenError';
  }
}
