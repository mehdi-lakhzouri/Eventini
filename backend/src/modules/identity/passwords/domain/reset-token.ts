import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_BYTES = 32;

export interface ResetTokenPair {
  /** Goes into the email link, once. Never stored. */
  readonly token: string;
  readonly tokenHash: string;
}

/**
 * HMAC-SHA-256 with the dedicated reset secret, not a bare digest.
 *
 * The corpus says both: §4.5's column note reads "SHA-256", while §9's key
 * table lists "Reset de mot de passe | HMAC-SHA-256" as one of the seven
 * independent secrets — and `PASSWORD_RESET_TOKEN_SECRET` exists in the
 * environment for exactly that. §9 wins: it is the section that owns key
 * management, and a keyed hash means a leaked database cannot be used to mint
 * a working reset link.
 */
export function hashResetToken(token: string, secret: string): string {
  return createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(token, 'utf8')
    .digest('hex');
}

export function issueResetToken(secret: string): ResetTokenPair {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');

  return { token, tokenHash: hashResetToken(token, secret) };
}

export function resetTokenMatches(
  token: string,
  expectedHash: string,
  secret: string,
): boolean {
  const actual = Buffer.from(hashResetToken(token, secret), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
