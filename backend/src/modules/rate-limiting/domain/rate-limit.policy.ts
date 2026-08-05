import { redisKeys } from '../../../infrastructure/redis/redis-key.builder';

/** One window to check: a key, a ceiling and a span. */
export interface RateLimitRule {
  readonly key: string;
  readonly limit: number;
  readonly windowMs: number;
}

export interface RequestFacts {
  readonly method: string;
  /** Path with the `/api/v1` prefix already stripped. */
  readonly path: string;
  readonly ip: string | null;
  readonly authenticated: boolean;
  /** Present only once a body has been parsed and only for the login route. */
  readonly email: string | null;
  readonly challengeId: string | null;
  readonly sessionId: string | null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface PolicySettings {
  readonly globalPerIp: number;
  readonly globalPerUnauthenticatedIp: number;
  readonly loginPerIpAndEmail: number;
  readonly loginWindowMs: number;
  readonly loginPerIp: number;
  readonly mfaVerify: number;
  readonly refresh: number;
  readonly passwordResetPerEmail: number;
}

/**
 * Which windows apply to one request — §3 and §4.
 *
 * Every applicable layer is returned, not the first match: a login crosses the
 * global IP window *and* both login windows, and §2's rule is that the most
 * restrictive wins. Returning one rule would let a request that is within its
 * endpoint budget still exhaust the infrastructure budget unnoticed.
 *
 * The routes named here are the sensitive ones the specification enumerates.
 * Everything else is covered by the global layer alone, which is the intent:
 * a per-endpoint ceiling on a read is a support ticket waiting to happen.
 */
export function rulesFor(
  facts: RequestFacts,
  settings: PolicySettings,
): RateLimitRule[] {
  const rules: RateLimitRule[] = [
    {
      key: redisKeys.rateLimit.globalIp(facts.ip),
      limit: facts.authenticated
        ? settings.globalPerIp
        : settings.globalPerUnauthenticatedIp,
      windowMs: MINUTE,
    },
  ];

  if (isRoute(facts, 'POST', '/auth/sessions')) {
    rules.push({
      key: redisKeys.rateLimit.loginIp(facts.ip),
      limit: settings.loginPerIp,
      windowMs: settings.loginWindowMs,
    });

    // Unconditional, and that is the point. This guard runs *before* the
    // validation pipe, so `email` here is whatever the caller sent — a number,
    // an array, or nothing at all. Making the window conditional on it would
    // let a caller delete their own rate limit by malforming the field, which
    // is why CodeQL flags a user-controlled value guarding a sensitive action.
    //
    // An unusable address falls into one shared bucket instead. Those attempts
    // cannot authenticate anyway, and bucketing them together still counts
    // them rather than letting them through uncounted.
    rules.push({
      key: redisKeys.rateLimit.loginIpEmail(facts.ip, emailBucket(facts.email)),
      limit: settings.loginPerIpAndEmail,
      windowMs: settings.loginWindowMs,
    });
  }

  // The route decides, not the value: the id is part of the path this pattern
  // just matched, so there is no caller-controlled way to skip the window.
  const challengeId = mfaChallengeIdOf(facts);

  if (challengeId !== null) {
    rules.push({
      key: redisKeys.rateLimit.mfaVerify(challengeId),
      limit: settings.mfaVerify,
      windowMs: 5 * MINUTE,
    });
  }

  if (
    facts.sessionId !== null &&
    isRoute(facts, 'POST', '/auth/sessions/current/rotation')
  ) {
    rules.push({
      key: redisKeys.rateLimit.refresh(facts.sessionId),
      limit: settings.refresh,
      windowMs: HOUR,
    });
  }

  if (isRoute(facts, 'POST', '/auth/password-reset-requests')) {
    rules.push({
      key: redisKeys.rateLimit.passwordResetIp(facts.ip),
      limit: 10,
      windowMs: HOUR,
    });

    // Unconditional for the same reason as the login window above.
    rules.push({
      key: redisKeys.rateLimit.passwordResetEmail(emailBucket(facts.email)),
      limit: settings.passwordResetPerEmail,
      windowMs: HOUR,
    });
  }

  if (isRoute(facts, 'POST', '/auth/password-resets')) {
    rules.push({
      key: redisKeys.rateLimit.passwordResetIp(facts.ip),
      limit: 5,
      windowMs: HOUR,
    });
  }

  return rules;
}

/**
 * Routes whose limiter must fail **closed** when Redis is unreachable — §7.4.
 *
 * A broken limiter must not make the product unusable, but it must never open
 * the door to brute force. An event in progress keeps working; sign-ins are
 * suspended until Redis returns.
 */
export function failsClosed(facts: RequestFacts): boolean {
  return (
    facts.path.startsWith('/auth/sessions') ||
    facts.path.startsWith('/auth/mfa') ||
    facts.path.startsWith('/auth/password') ||
    facts.path.startsWith('/auth/invitation')
  );
}

function isRoute(facts: RequestFacts, method: string, path: string): boolean {
  return facts.method === method && normalize(facts.path) === path;
}

/**
 * A stable bucket for a request whose address is missing or not even a string.
 *
 * It cannot collide with a real address: `@` is required in anything that
 * would reach a successful login, and this value contains none.
 */
const UNUSABLE_EMAIL_BUCKET = 'unusable-address';

function emailBucket(email: string | null): string {
  return email !== null && email.trim() !== '' ? email : UNUSABLE_EMAIL_BUCKET;
}

/** The id out of `/auth/mfa/challenges/{id}/verification`, or null. */
function mfaChallengeIdOf(facts: RequestFacts): string | null {
  if (facts.method !== 'POST') {
    return null;
  }

  const match = /^\/auth\/mfa\/challenges\/([^/]+)\/verification$/.exec(
    normalize(facts.path),
  );

  return match?.[1] ?? null;
}

/** Trailing slashes would otherwise make `/auth/sessions/` a different route. */
function normalize(path: string): string {
  const withoutTrailing = path.length > 1 ? path.replace(/\/+$/, '') : path;

  return withoutTrailing === '' ? '/' : withoutTrailing;
}
