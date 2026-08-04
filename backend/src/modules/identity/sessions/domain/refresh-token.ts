import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 bytes, per AUTHENTICATION_AUTHORIZATION.md §1.2. */
const TOKEN_BYTES = 32;

export interface RefreshTokenPair {
  /** Sent to the client, once. Never stored. */
  readonly token: string;
  /** Stored. HMAC-SHA-256, so a database dump cannot replay a session. */
  readonly tokenHash: string;
}

/**
 * Keyed, not plain SHA-256. The token is high-entropy so a plain digest would
 * resist a dictionary attack anyway, but the HMAC means a leaked database is
 * useless without a secret held outside it — the same reasoning as the
 * password pepper.
 */
export function hashRefreshToken(token: string, secret: string): string {
  return createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(token, 'utf8')
    .digest('hex');
}

export function issueRefreshToken(secret: string): RefreshTokenPair {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');

  return { token, tokenHash: hashRefreshToken(token, secret) };
}

/**
 * Compared in constant time. Lookup is by hash so the timing leak is small,
 * but "small" is not a reason to hand it over.
 */
export function refreshTokenMatches(
  token: string,
  expectedHash: string,
  secret: string,
): boolean {
  const actual = Buffer.from(hashRefreshToken(token, secret), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
