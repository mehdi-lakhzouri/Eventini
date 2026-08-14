/** Lower-case because that is how Node normalises incoming header names. */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/**
 * ULID or UUID v4, 16 to 128 characters — IDEMPOTENCY_AND_CONCURRENCY.md §2.
 *
 * Bounded and restricted because the key is stored and logged: an unbounded
 * client-controlled string on a table that grows with every mutating request
 * is a way to spend somebody else's disk, and the character class keeps the
 * value safe to print in a log line without escaping.
 */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** ADR-0012: the in-flight answer is a `409`, and this is what it advertises. */
export const IN_FLIGHT_RETRY_AFTER_SECONDS = 2;

/**
 * How long a `PENDING` claim is believed.
 *
 * Past it, the row is assumed to belong to a process that died mid-request and
 * the next attempt takes it over; without that, one crash wedges that key
 * until it expires, which under the 7-day attendance retention means a week.
 *
 * Sixty seconds is a compromise with a real cost on both sides. Shorter and a
 * genuinely slow request gets taken over and runs twice; longer and a crashed
 * request blocks its key for longer. It is set above any request this API
 * should ever serve — the check-in path is a single write — so a request still
 * running at sixty seconds is far likelier to be dead than slow.
 */
export const IN_FLIGHT_LOCK_SECONDS = 60;

/**
 * The two retention windows of ADR-0012, and nothing else.
 *
 * A closed set rather than a parsed duration: the choice is between "an
 * ordinary mutation" and "something a scanner may replay days later", and
 * exposing an arbitrary number would invite a third answer nobody reasoned
 * about.
 *
 * 7 days is not generosity. A scanner can be offline for the whole of a
 * multi-day event, and a 24-hour window would turn its perfectly legitimate
 * replay into a second check-in — the exact failure this table exists to
 * prevent.
 */
export const IDEMPOTENCY_RETENTION_SECONDS = {
  '24h': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
} as const;

export type IdempotencyRetention = keyof typeof IDEMPOTENCY_RETENTION_SECONDS;
