/**
 * What one window check answered.
 *
 * `retryAfterSeconds` is only meaningful when refused, and it is what the
 * `429` reports — never which dimension produced it. Naming the dimension
 * ("per-email limit reached") would confirm that the account exists, which is
 * the same disclosure the login endpoint spends a decoy hash avoiding.
 */
export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

export const ALLOWED_WITHOUT_LIMIT: RateLimitDecision = {
  allowed: true,
  limit: 0,
  remaining: 0,
  retryAfterSeconds: 0,
};

/**
 * The most restrictive layer wins: a request crosses every applicable layer
 * and the first refusal is the answer. Among refusals the longest wait is
 * kept, so a client that retries on `Retry-After` is not immediately refused
 * again by a slower layer it had also exceeded.
 */
export function strictestOf(
  decisions: readonly RateLimitDecision[],
): RateLimitDecision {
  const refused = decisions.filter((decision) => !decision.allowed);

  if (refused.length > 0) {
    return refused.reduce((worst, decision) =>
      decision.retryAfterSeconds > worst.retryAfterSeconds ? decision : worst,
    );
  }

  // All allowed: report the layer closest to its ceiling, so `RateLimit-*`
  // describes the real headroom rather than the most generous layer's.
  return decisions.reduce(
    (tightest, decision) =>
      decision.remaining < tightest.remaining ? decision : tightest,
    decisions[0] ?? ALLOWED_WITHOUT_LIMIT,
  );
}
