import { z } from 'zod';

import { describeError } from './describe-error';
import { parseDuration } from './parsers/duration.parser';
import { parseSize } from './parsers/size.parser';
import { parseCsv, parseCsvIntegers } from './parsers/csv.parser';

/**
 * Shape and defaults for every environment variable, per
 * `docs/operations/ENVIRONMENT_VARIABLES.md`.
 *
 * This layer answers "is each value individually well-formed?". It does not
 * answer "are these values coherent with each other?" — that is
 * `rules/`, which owns the 14 cross-checks of §17. Keeping the two apart is
 * what allows every failure to be reported at once instead of the first one.
 *
 * Why zod rather than class-validator (which is already installed): zod
 * validates and infers a type in one pass and runs as a plain function, so it
 * can execute *before* Nest bootstraps. class-validator needs an instantiated
 * class, which only exists once the DI container is up — far too late to
 * refuse to start.
 */

const duration = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((value, ctx) => {
      try {
        return parseDuration(value);
      } catch (error) {
        ctx.addIssue({
          code: 'custom',
          message: describeError(error),
        });
        return z.NEVER;
      }
    });

const size = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((value, ctx) => {
      try {
        return parseSize(value);
      } catch (error) {
        ctx.addIssue({
          code: 'custom',
          message: describeError(error),
        });
        return z.NEVER;
      }
    });

const integer = (fallback?: number) => {
  const base = z.coerce.number().int();
  return fallback === undefined ? base : base.default(fallback);
};

const boolean = (fallback: boolean) =>
  z
    .enum(['true', 'false'])
    .default(fallback ? 'true' : 'false')
    .transform((value) => value === 'true');

/** A secret is only shape-checked here; entropy and reuse are rules 7-9. */
const secret = () => z.string().min(1);

export const envSchema = z.object({
  // ---- Application -------------------------------------------------------
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
  // 3001, not 3000: 3000 is the Next dev server, and the frontend default
  // pointed there, making the web app call itself (FRONTEND_ARCHITECTURE F-5).
  PORT: integer(3001).pipe(z.number().min(1).max(65535)),
  API_BASE_URL: z.url(),
  TRUSTED_PROXY_HOPS: integer(1).pipe(z.number().min(0)),
  SHUTDOWN_TIMEOUT_MS: integer(15_000).pipe(z.number().min(0)),
  SWAGGER_ENABLED: boolean(false),

  // ---- PostgreSQL --------------------------------------------------------
  DATABASE_URL: z.string().min(1),
  SHADOW_DATABASE_URL: z.string().optional(),
  DATABASE_POOL_SIZE: integer(10).pipe(z.number().min(1)),
  DATABASE_CONNECT_TIMEOUT_MS: integer(10_000).pipe(z.number().min(0)),
  DATABASE_STATEMENT_TIMEOUT_MS: integer(30_000).pipe(z.number().min(0)),
  DATABASE_SLOW_QUERY_THRESHOLD_MS: integer(500).pipe(z.number().min(0)),

  // ---- Redis -------------------------------------------------------------
  REDIS_URL: z.string().min(1),
  REDIS_QUEUE_DB: integer(1).pipe(z.number().min(0)),
  REDIS_PUBSUB_DB: integer(2).pipe(z.number().min(0)),
  REDIS_TLS_ENABLED: boolean(false),
  REDIS_CONNECT_TIMEOUT_MS: integer(5_000).pipe(z.number().min(0)),
  REDIS_MAX_RETRIES: integer(3).pipe(z.number().min(0)),

  // ---- Cryptography ------------------------------------------------------
  // No defaults, by design. A secret with a fallback is a secret that ships.
  ACCESS_TOKEN_PRIVATE_KEY: secret(),
  ACCESS_TOKEN_PUBLIC_KEY: secret(),
  ACCESS_TOKEN_KEY_ID: z.string().min(1),
  ACCESS_TOKEN_PREVIOUS_PUBLIC_KEY: z.string().optional(),
  ACCESS_TOKEN_PREVIOUS_KEY_ID: z.string().optional(),
  ACCESS_TOKEN_ISSUER: z.url(),
  ACCESS_TOKEN_AUDIENCE_WEB: z.string().min(1).default('eventini-web'),
  ACCESS_TOKEN_AUDIENCE_SCANNER: z.string().min(1).default('eventini-scanner'),
  REFRESH_TOKEN_HMAC_SECRET: secret(),
  CSRF_SECRET: secret(),
  MFA_ENCRYPTION_KEY: secret(),
  INVITATION_TOKEN_SECRET: secret(),
  PASSWORD_RESET_TOKEN_SECRET: secret(),
  QR_SIGNING_PRIVATE_KEY: secret(),
  QR_SIGNING_PUBLIC_KEY: secret(),
  QR_SIGNING_KEY_ID: z.string().min(1),
  PASSWORD_PEPPER: secret(),
  COOKIE_SECRET: secret(),

  // ---- Authentication ----------------------------------------------------
  // Configurable, but not free-tuning knobs: changing these without reading
  // ADR-0007 and ADR-0009 changes the security posture.
  ARGON2_MEMORY_COST: integer(19_456),
  ARGON2_TIME_COST: integer(2).pipe(z.number().min(1)),
  ARGON2_PARALLELISM: integer(1).pipe(z.number().min(1)),
  ARGON2_HASH_LENGTH: integer(32).pipe(z.number().min(16)),
  PASSWORD_MIN_LENGTH: integer(12).pipe(z.number().min(12)),
  PASSWORD_MAX_LENGTH: integer(128).pipe(z.number().max(1024)),

  ACCESS_TOKEN_TTL_WEB_ADMIN: duration('10m'),
  ACCESS_TOKEN_TTL_WEB_SUPER_ADMIN: duration('5m'),
  ACCESS_TOKEN_TTL_SCANNER: duration('15m'),
  REFRESH_TOKEN_TTL_WEB_ADMIN: duration('14d'),
  REFRESH_TOKEN_TTL_WEB_SUPER_ADMIN: duration('1d'),
  REFRESH_TOKEN_TTL_SCANNER: duration('30d'),
  SESSION_IDLE_TTL_WEB_ADMIN: duration('12h'),
  SESSION_IDLE_TTL_WEB_SUPER_ADMIN: duration('30m'),
  SESSION_IDLE_TTL_SCANNER: duration('7d'),
  SESSION_ABSOLUTE_TTL_WEB_ADMIN: duration('30d'),
  SESSION_ABSOLUTE_TTL_WEB_SUPER_ADMIN: duration('7d'),
  SESSION_ABSOLUTE_TTL_SCANNER: duration('90d'),

  PASSWORD_RESET_TTL: duration('30m'),
  EMAIL_VERIFICATION_TTL: duration('24h'),
  INVITATION_TTL: duration('7d'),
  MFA_CHALLENGE_TTL: duration('5m'),
  MFA_CHALLENGE_MAX_ATTEMPTS: integer(5).pipe(z.number().min(1)),
  REAUTHENTICATION_TTL: duration('10m'),
  TOTP_DIGITS: integer(6).pipe(z.number().min(6).max(8)),
  TOTP_PERIOD_SECONDS: integer(30).pipe(z.number().min(15)),
  TOTP_DRIFT_WINDOWS: integer(1).pipe(z.number().min(0).max(2)),
  RECOVERY_CODE_COUNT: integer(10).pipe(z.number().min(5)),
  JWT_CLOCK_TOLERANCE_SECONDS: integer(30).pipe(z.number().min(0).max(300)),

  // ---- Cookies and CSRF --------------------------------------------------
  COOKIE_ACCESS_NAME: z.string().min(1).default('__Host-eventini_access'),
  COOKIE_REFRESH_NAME: z.string().min(1).default('__Secure-eventini_refresh'),
  COOKIE_CSRF_NAME: z.string().min(1).default('__Host-eventini_csrf'),
  COOKIE_CSRF_CONTEXT_NAME: z
    .string()
    .min(1)
    .default('__Host-eventini_csrf_ctx'),
  COOKIE_REFRESH_PATH: z.string().min(1).default('/api/v1/auth/sessions'),
  COOKIE_SECURE: boolean(true),
  COOKIE_SAMESITE_ACCESS: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_SAMESITE_REFRESH: z.enum(['lax', 'strict', 'none']).default('strict'),
  CSRF_CONTEXT_TTL: duration('30m'),

  // ---- CORS --------------------------------------------------------------
  CORS_ALLOWED_ORIGINS: z.string().min(1).transform(parseCsv),
  CORS_MAX_AGE_SECONDS: integer(600).pipe(z.number().min(0)),

  // ---- Rate limiting -----------------------------------------------------
  RATE_LIMIT_GLOBAL_IP: integer(300).pipe(z.number().min(1)),
  RATE_LIMIT_GLOBAL_USER: integer(1_000).pipe(z.number().min(1)),
  RATE_LIMIT_GLOBAL_ORG: integer(5_000).pipe(z.number().min(1)),
  RATE_LIMIT_LOGIN_IP_EMAIL: integer(5).pipe(z.number().min(1)),
  RATE_LIMIT_LOGIN_IP_EMAIL_WINDOW: duration('15m'),
  RATE_LIMIT_LOGIN_IP: integer(20).pipe(z.number().min(1)),
  RATE_LIMIT_MFA_VERIFY: integer(5).pipe(z.number().min(1)),
  RATE_LIMIT_REFRESH: integer(30).pipe(z.number().min(1)),
  RATE_LIMIT_PASSWORD_RESET_EMAIL: integer(3).pipe(z.number().min(1)),
  RATE_LIMIT_CHECKIN_DEVICE: integer(600).pipe(z.number().min(1)),
  LOCKOUT_THRESHOLDS: z.string().default('5,10,15').transform(parseCsvIntegers),
  LOCKOUT_DURATIONS: z
    .string()
    .default('15m,1h,24h')
    .transform((value, ctx) => {
      try {
        return parseCsv(value).map(parseDuration);
      } catch (error) {
        ctx.addIssue({
          code: 'custom',
          message: describeError(error),
        });
        return z.NEVER;
      }
    }),
  // Fail closed on authentication, fail open elsewhere: a broken rate limiter
  // must never open the door to brute force, but must not take the whole
  // application down either (RATE_LIMITING_AND_ABUSE_PREVENTION.md §7.4).
  RATE_LIMIT_FAIL_MODE_AUTH: z.enum(['closed', 'open']).default('closed'),
  RATE_LIMIT_FAIL_MODE_OTHER: z.enum(['closed', 'open']).default('open'),

  // ---- Resource limits ---------------------------------------------------
  BODY_LIMIT_JSON: size('100kb'),
  BODY_LIMIT_IMPORT: size('10mb'),
  PAGINATION_DEFAULT_LIMIT: integer(20).pipe(z.number().min(1)),
  PAGINATION_MAX_LIMIT: integer(100).pipe(z.number().min(1)),
  SEARCH_MIN_LENGTH: integer(2).pipe(z.number().min(1)),
  SEARCH_MAX_LENGTH: integer(100).pipe(z.number().min(1)),
  IMPORT_MAX_ROWS: integer(50_000).pipe(z.number().min(1)),
  ATTENDANCE_SYNC_MAX_OPERATIONS: integer(500).pipe(z.number().min(1)),
  JOB_MAX_CONCURRENT_PER_ORG: integer(3).pipe(z.number().min(1)),
  JOB_TIMEOUT_MS: integer(900_000).pipe(z.number().min(1_000)),
  JOB_MAX_ATTEMPTS: integer(5).pipe(z.number().min(1)),
  IDEMPOTENCY_RETENTION: duration('24h'),
  IDEMPOTENCY_RETENTION_ATTENDANCE: duration('7d'),
  QR_REPLAY_WINDOW_SECONDS: integer(90).pipe(z.number().min(1)),
  SSE_MAX_CONNECTIONS_PER_USER: integer(10).pipe(z.number().min(1)),

  // ---- Email -------------------------------------------------------------
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: integer().pipe(z.number().min(1).max(65535)),
  SMTP_USER: z.string().min(1),
  SMTP_PASSWORD: z.string().min(1),
  SMTP_SECURE: boolean(true),
  MAIL_FROM_ADDRESS: z.email(),
  MAIL_FROM_NAME: z.string().min(1).default('Eventini'),
  MAIL_REPLY_TO: z.email().optional(),
  WEB_BASE_URL: z.url(),

  // ---- Observability -----------------------------------------------------
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
  LOG_PRETTY: boolean(false),
  LOG_SERVICE_NAME: z.string().min(1).default('eventini-api'),
  LOG_SERVICE_VERSION: z.string().min(1).default('0.0.1'),
  LOG_REDACTION_ENABLED: boolean(true),
  LOG_HTTP_ENABLED: boolean(true),
  LOG_HTTP_SUCCESS_ENABLED: boolean(true),
  LOG_SLOW_REQUEST_THRESHOLD_MS: integer(1_000).pipe(z.number().min(0)),
  LOG_SLOW_QUERY_THRESHOLD_MS: integer(500).pipe(z.number().min(0)),
  LOG_DEBUG_MODULES: z.string().optional(),
  LOG_DEBUG_EXPIRES_AT: z.string().optional(),
  METRICS_ENABLED: boolean(true),
  METRICS_PATH: z.string().min(1).default('/metrics'),
  INSTANCE_ID: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().optional(),

  // ---- Bootstrap ---------------------------------------------------------
  BOOTSTRAP_SUPER_ADMIN_EMAIL: z.email().optional(),
  SEED_DEMO_DATA: boolean(false),
});

/** The fully parsed, defaulted and typed environment. */
export type Env = z.infer<typeof envSchema>;
