import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * CORS with exact origins, never a pattern.
 *
 * `CORS_ALLOWED_ORIGINS` is already a parsed `string[]` by the time this runs
 * (env.schema.ts). Passing that array straight to the `cors` package makes it
 * do exact string comparison per origin — never `.includes()`, which
 * `AUTHENTICATION_AUTHORIZATION.md` §3.5 explicitly forbids: it would let
 * `https://evil.com/eventini.com` or similar through.
 *
 * `credentials: true` is required for cookie-based auth to work cross-origin
 * at all; combined with an exact origin list rather than `*`, which the
 * browser refuses to combine with credentials anyway.
 */
export function buildCorsOptions(
  allowedOrigins: readonly string[],
  maxAgeSeconds: number,
): CorsOptions {
  return {
    origin: allowedOrigins as string[],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'X-CSRF-Token',
      'Idempotency-Key',
      'If-Match',
      'traceparent',
      'X-Request-Id',
    ],
    exposedHeaders: [
      'X-Request-Id',
      'ETag',
      'Retry-After',
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
    ],
    maxAge: maxAgeSeconds,
  };
}
