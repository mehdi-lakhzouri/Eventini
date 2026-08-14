import { randomInt } from 'node:crypto';

const JITTER_PERCENT = 10;

/**
 * `Retry-After` with ±10% jitter — RATE_LIMITING_AND_ABUSE_PREVENTION.md §6.
 *
 * Without it every client refused in the same window retries on the same
 * second and rebuilds the spike the limiter just flattened. The jitter is the
 * difference between a limiter that sheds load and one that reschedules it.
 *
 * `randomInt` rather than `Math.random`: this is not a security boundary, but
 * the codebase uses the CSPRNG for anything that must not be predictable, and
 * a predictable retry schedule is exactly what an attacker would synchronise
 * against to keep a queue permanently saturated.
 */
export function jitteredRetryAfter(seconds: number): number {
  if (seconds <= 0) {
    return 1;
  }

  const spread = Math.max(1, Math.round((seconds * JITTER_PERCENT) / 100));
  // randomInt's upper bound is exclusive, hence the +1 for a symmetric range.
  const offset = randomInt(-spread, spread + 1);

  // Never below 1: `Retry-After: 0` invites an immediate retry, which is the
  // behaviour the header exists to prevent.
  return Math.max(1, seconds + offset);
}
