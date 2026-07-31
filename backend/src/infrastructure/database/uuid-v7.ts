import { randomBytes } from 'node:crypto';

/**
 * UUID version 7, per RFC 9562 §5.7.
 *
 * ## Why this is implemented here rather than taken from `uuid`
 *
 * The `uuid` package ships ESM-only. Jest does not transform `node_modules`,
 * and this project's `transform` matches `.ts` only, so widening it to cover
 * `uuid`'s `.js` would put ts-jest across package code on every run. The same
 * packaging problem already forced `RequestIdMiddleware` (EVT-011) off `uuid`
 * and onto `randomUUID`, so this is the second time it has cost something.
 *
 * What is being written is a byte layout, not a cryptographic primitive: all
 * the entropy comes from `randomBytes`, which is the platform CSPRNG. That is
 * the line worth respecting — inventing the randomness would be reckless,
 * arranging documented bits around it is not.
 *
 * ## The layout
 *
 * ```
 *  0                   1                   2                   3
 *  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |                unix_ts_ms (48 bits, big-endian)               |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |  ver (0111)   |    counter (12 bits)  | var |   random (62)   |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * ```
 *
 * ## Why the counter, and not 12 more random bits
 *
 * RFC 9562 §6.2 method 1. The whole point of v7 over v4 is that ids sort by
 * creation time, which keeps index inserts local instead of scattering them —
 * the reason DATABASE_SCHEMA.md §2.1 chose it, given `attendance_records` and
 * `audit_logs`. Within a single millisecond, random bits would order
 * arbitrarily, so a burst of inserts (a scanner queue draining, a bulk
 * import) would lose exactly the property being paid for. A counter in
 * `rand_a` makes ordering total rather than merely approximate.
 */

const MAX_COUNTER = 0xfff; // 12 bits of rand_a.

let lastTimestampMs = 0;
let counter = 0;

function nextCounter(timestampMs: number): number {
  if (timestampMs !== lastTimestampMs) {
    lastTimestampMs = timestampMs;
    // Start low, not at zero: leaving headroom means the rollover branch
    // below is genuinely unreachable in normal operation rather than merely
    // unlikely.
    counter = randomBytes(1)[0] ?? 0;
    return counter;
  }

  counter += 1;

  if (counter > MAX_COUNTER) {
    // 4096 ids inside one millisecond. Rather than emit a value that would
    // sort before its predecessor, borrow from the next millisecond — the
    // timestamp is only ever used for ordering, and being one millisecond
    // ahead preserves it.
    lastTimestampMs += 1;
    counter = 0;
  }

  return counter;
}

export function uuidV7(): string {
  const timestampMs = Math.max(Date.now(), lastTimestampMs);
  const value = nextCounter(timestampMs);
  const effectiveTimestamp = lastTimestampMs;

  const bytes = randomBytes(16);

  // 48-bit timestamp, big-endian. Split because a 48-bit value exceeds what
  // bitwise operators handle: they coerce to 32-bit signed integers.
  bytes.writeUIntBE(effectiveTimestamp, 0, 6);

  // Version 7 in the high nibble of byte 6, counter in the remaining 12 bits.
  bytes[6] = 0x70 | ((value >>> 8) & 0x0f);
  bytes[7] = value & 0xff;

  // RFC 4122 variant (10xx) in the high bits of byte 8; the rest stays random.
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);

  const hex = bytes.toString('hex');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
