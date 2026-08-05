import { createHash } from 'node:crypto';

import { normalizeEmail } from '../database/normalize-email';

/**
 * The three primitives every key in `redis-key.builder.ts` is assembled from.
 *
 * Kept apart from the catalogue so the catalogue reads as a list of key shapes
 * and nothing else, and so the escaping rules have somewhere to be tested on
 * their own.
 */

const HEX_CHARACTERS_FOR_128_BITS = 32;

/**
 * `SHA-256(normalized_email)` truncated to 128 bits, hexadecimal —
 * REDIS_KEYS_AND_LUA_SCRIPTS.md §3.
 *
 * Keys show up in `MONITOR`, `SLOWLOG`, `--bigkeys` and every diagnostic dump
 * an operator takes during an incident. A plaintext address there is a PII
 * leak into places nobody thinks of as a data store.
 *
 * Normalisation happens here rather than at the call site: the hash of
 * `A@x.com` and of `a@x.com` must be the same counter, or an attacker skips a
 * per-email limit by changing case. Making the builder do it means no caller
 * can forget.
 *
 * 128 bits is not a shortcut. A truncated SHA-256 has ~2^64 collision
 * resistance, and the value being protected is an email address an attacker
 * would have to already know to test a guess against. What matters is
 * pre-image resistance, which truncation leaves intact.
 */
export function hashEmail(email: string): string {
  return createHash('sha256')
    .update(normalizeEmail(email), 'utf8')
    .digest('hex')
    .slice(0, HEX_CHARACTERS_FOR_128_BITS);
}

/**
 * An IP address as a key segment.
 *
 * IPv6 is written with colons, and `:` is the key separator (§3), so it is
 * rewritten to `-`. The mapping is injective: no textual IP address of either
 * family contains a hyphen, so two distinct addresses cannot collapse onto one
 * counter — which would be the difference between limiting two clients and
 * limiting them as if they were one.
 *
 * `::ffff:a.b.c.d` is the IPv4-mapped form Node reports for an IPv4 client on
 * a dual-stack socket. Left as-is, the same client counted under two different
 * keys depending on how the listener was bound.
 */
export function ipSegment(ip: string | null | undefined): string {
  if (ip === null || ip === undefined || ip.trim() === '') {
    // A request with no resolvable peer address should still be counted, and
    // counted together with every other one, rather than escaping the limit.
    return 'unknown';
  }

  const lowered = ip.trim().toLowerCase();
  const unmapped = lowered.startsWith('::ffff:')
    ? lowered.slice('::ffff:'.length)
    : lowered;

  return unmapped.replaceAll(':', '-');
}

/**
 * Any other opaque identifier — session, organization, device, challenge.
 *
 * Identifiers in this system are prefixed base32 strings, so the replacement
 * below never fires in practice. It exists because a key segment is the one
 * place where a value that came off the wire meets the separator character:
 * an identifier carrying a `:` or a space would silently rewrite the key's
 * shape, and a counter written under one shape is not the counter read back
 * under another.
 */
export function idSegment(value: string): string {
  const trimmed = value.trim().toLowerCase();

  return trimmed === '' ? 'unknown' : trimmed.replaceAll(/[^a-z0-9_.-]/g, '-');
}
