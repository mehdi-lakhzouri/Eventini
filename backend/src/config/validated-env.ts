import { validateEnvironment } from './validate-environment';
import type { Env } from './env.schema';

let cached: Env | null = null;

/**
 * Returns the validated environment, computed once per process and cached.
 *
 * ## Why this exists
 *
 * `registerAs()` factories (application.config.ts and its siblings) are plain
 * functions with no dependency-injection access, so they cannot receive the
 * object `ConfigModule.forRoot({ validate })` already computed — that result
 * is only reachable through `ConfigService`, which `registerAs` factories
 * cannot inject.
 *
 * Every one of those factories used to read `process.env` directly and cast
 * it to `Env`. That compiled, because the cast is unchecked, but it was wrong
 * at runtime: `process.env` can only ever hold strings, so `PORT` came back
 * as `"3001"` rather than the number `3001`, `SWAGGER_ENABLED` as the string
 * `"true"` rather than the boolean, and `CORS_ALLOWED_ORIGINS` did not survive
 * at all. Confirmed by booting the real application and inspecting the
 * resolved config: CORS silently allowed no origin whatsoever, allowed or
 * not, because the array that `parseCsv` produces cannot round-trip through
 * `process.env`.
 *
 * This function is the fix: it re-parses `process.env` through the same pure
 * `validateEnvironment`, into a real object with real types, and every
 * namespace reads from that instead. `ConfigModule.forRoot`'s own `validate`
 * hook is deliberately left in place as well — it is what gates any consumer
 * of `AppModule` that is not `main.ts` (an e2e test bootstrapping the module
 * directly, for instance). Both call the same pure function against the same
 * input, so they cannot diverge; the duplication is intentional and cheap,
 * not an oversight.
 */
export function getValidatedEnv(): Env {
  cached ??= validateEnvironment(process.env);
  return cached;
}

/** Test-only: clears the cache so a spec can validate a different environment. */
export function resetValidatedEnvCache(): void {
  cached = null;
}
