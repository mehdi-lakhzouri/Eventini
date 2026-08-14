import { randomInt } from 'node:crypto';

/**
 * Crockford base32 — sprint-03 EVT-015.
 *
 * Excludes I, L, O and U. The first three because they are indistinguishable
 * from 1 and 0 in most fonts, and U because removing it makes accidental
 * profanity far less likely. This matters more here than in most encodings:
 * an event code is read off a screen or a printed sheet and typed into a
 * scanner by someone standing at a venue door, so a character that invites a
 * misread costs a support call at the worst possible moment.
 */
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** DATABASE_SCHEMA.md §6.1. */
export const EVENT_CODE_LENGTH = 8;

/**
 * Generates an event code.
 *
 * ## Why this must be unpredictable, not merely unique
 *
 * The code is unique *globally* rather than per organization, which looks
 * like a violation of the tenant-first rule and is its inverse: a scanner
 * types this code **before any tenant is known**, so the code is what
 * resolves the tenant. A sequential or guessable code would therefore let
 * someone bind a scanner to another organization's event — a cross-tenant
 * breach reachable from the login screen of a device.
 *
 * `randomInt` from `node:crypto` rather than `Math.random`: the latter is a
 * fast non-cryptographic PRNG whose output is predictable from a handful of
 * observed values, which is exactly the attack this exists to prevent.
 *
 * It also avoids modulo bias — `randomBytes(1)[0] % 32` would be uniform only
 * because 256 happens to divide by 32, and that accident stops holding the
 * moment the alphabet changes length. `randomInt(max)` is unbiased for any
 * bound, so the property survives an edit to the alphabet.
 *
 * 32^8 is about 1.1 × 10^12 codes. Uniqueness is still enforced by
 * `ux_events_event_code_active`, not assumed here: a generator that only
 * *probably* does not collide is a generator that collides in production.
 */
export function generateEventCode(length: number = EVENT_CODE_LENGTH): string {
  let code = '';

  for (let index = 0; index < length; index += 1) {
    code += CROCKFORD_ALPHABET[randomInt(CROCKFORD_ALPHABET.length)];
  }

  return code;
}

/**
 * Normalises a human-typed code.
 *
 * Crockford's decoding rules, and each one exists because of how the value is
 * entered: uppercase because keyboards and handwriting vary, `I`/`L` → `1`
 * and `O` → `0` because those are the misreadings the alphabet was chosen to
 * survive, and hyphens stripped because people group long codes when writing
 * them down.
 *
 * Applied to input only. Stored codes are already canonical.
 */
export function normalizeEventCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replaceAll('-', '')
    .replaceAll('I', '1')
    .replaceAll('L', '1')
    .replaceAll('O', '0');
}

/** Whether a normalised code could have been produced by this generator. */
export function isValidEventCode(
  input: string,
  length: number = EVENT_CODE_LENGTH,
): boolean {
  if (input.length !== length) {
    return false;
  }

  return [...input].every((character) =>
    CROCKFORD_ALPHABET.includes(character),
  );
}
