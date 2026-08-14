import { MAX_SCRUB_DEPTH, REDACTED_PLACEHOLDER } from './logging.constants';

/**
 * Every key whose value is a secret — PINO_LOGGING_SPECIFICATION.md §30.
 *
 * Matched by exact key name, case-insensitively, at any depth, by
 * `scrubSensitiveKeys` below.
 */
export const SENSITIVE_KEYS: readonly string[] = [
  // Credentials
  'password',
  'currentPassword',
  'newPassword',
  'passwordConfirmation',
  'passwordHash',

  // Tokens
  'accessToken',
  'refreshToken',
  'token',
  'tokenHash',
  'jwt',

  // CSRF
  'csrfToken',
  'x-csrf-token',

  // MFA
  'mfaSecret',
  'totpSecret',
  'totpCode',
  'recoveryCode',
  'recoveryCodes',

  // One-time links
  'invitationToken',
  'passwordResetToken',
  'emailVerificationToken',

  // Ticket credentials
  'qrPayload',
  'qrSignature',
  'qrSecret',

  // Infrastructure credentials
  'smtpPassword',
  'databaseUrl',
  'redisUrl',
  'apiKey',
  'clientSecret',
  'privateKey',

  // Transport headers carrying credentials
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
];

const SENSITIVE_KEY_SET = new Set(
  SENSITIVE_KEYS.map((key) => key.toLowerCase()),
);

/**
 * Pino's own `redact.paths` — §30, with the C-24 correction applied.
 *
 * Document D listed bare keys (`password`, `accessToken`, `mfaSecret`) next to
 * real paths (`req.headers.authorization`). A bare key is a *root-level path*
 * in Pino, not a "this key anywhere" matcher, so those entries silently
 * protected only `{password: …}` at the very top of a log object — which is
 * almost never where a secret actually sits.
 *
 * ## Why paths alone are still not enough
 *
 * Adding `*.password` (the correction C-24 asks for) fixes exactly one level
 * of nesting and no more. Verified against Pino's own redaction documentation
 * and by running it: with `paths: ['password', '*.password']`, the value in
 * `{a: {b: {password: 'x'}}}` is written out in clear. `**` is accepted by the
 * parser but does not recurse either.
 *
 * So these paths are the fast, well-trodden layer for the shapes we know, and
 * `scrubSensitiveKeys` below is the depth-independent backstop. Both run: this
 * is the one place in the codebase where belt and braces is proportionate,
 * because the failure mode is a credential in a log store that many people can
 * read and that is retained for months.
 */
export const REDACTION_PATHS: readonly string[] = [
  // Transport headers — removed entirely rather than censored, per §30
  // ("Pour les headers et secrets, préférer la suppression complète").
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',

  // Root-level and one-level-deep occurrences of each sensitive key.
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`]),
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_SET.has(key.toLowerCase());
}

/**
 * Replaces the value of any sensitive key at any depth.
 *
 * Runs as Pino's `formatters.log` hook, so it sees the merged object of every
 * log call. Depth is bounded (`MAX_SCRUB_DEPTH`) so a cyclic or pathologically
 * deep object degrades to "left untouched below the bound" rather than
 * hanging the process inside a logging statement — a logger must never be the
 * thing that takes the service down.
 *
 * Non-plain objects (Date, Buffer, Error, class instances) are returned as-is:
 * walking them would rewrite them into meaningless plain objects, and none of
 * them is a place a bare secret key lives.
 */
export function scrubSensitiveKeys(value: unknown, depth = 0): unknown {
  if (depth >= MAX_SCRUB_DEPTH || value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubSensitiveKeys(item, depth + 1));
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }

  const result: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(value)) {
    result[key] = isSensitiveKey(key)
      ? REDACTED_PLACEHOLDER
      : scrubSensitiveKeys(nested, depth + 1);
  }

  return result;
}
