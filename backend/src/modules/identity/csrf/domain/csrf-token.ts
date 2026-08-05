import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const NONCE_BYTES = 16;
const SEPARATOR = '.';

/**
 * A signed double-submit token — `nonce.HMAC(secret, binding‖nonce)`.
 *
 * An unsigned random value compared with `===` is forgeable by anyone who can
 * write the cookie and echo it back in the header, and it carries no link to
 * the caller: the same value would validate for everybody. Signing over the
 * binding is what makes a token belong to one context and one only, which is
 * the whole of ADR-0016.
 */
export function issueCsrfToken(secret: string, binding: string): string {
  const nonce = randomBytes(NONCE_BYTES).toString('base64url');

  return `${nonce}${SEPARATOR}${sign(secret, binding, nonce)}`;
}

export function csrfTokenMatches(
  secret: string,
  binding: string,
  token: string,
): boolean {
  const parts = token.split(SEPARATOR);
  const [nonce, mac] = parts;

  if (parts.length !== 2 || nonce === undefined || mac === undefined) {
    return false;
  }

  return equalsInConstantTime(mac, sign(secret, binding, nonce));
}

/**
 * `timingSafeEqual` throws on a length mismatch rather than returning false,
 * so lengths are compared first. A length difference is not a secret here —
 * both operands are fixed-width base64url digests.
 */
export function equalsInConstantTime(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');

  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The binding is length-prefixed so no two different pairs hash the same
 * bytes: without it, binding `ab` with nonce `c` and binding `a` with nonce
 * `bc` would produce the same signature, making a token transferable between
 * two contexts whose names happen to line up.
 */
function sign(secret: string, binding: string, nonce: string): string {
  return createHmac('sha256', secret)
    .update(`${binding.length}:${binding}:${nonce}`)
    .digest('base64url');
}
