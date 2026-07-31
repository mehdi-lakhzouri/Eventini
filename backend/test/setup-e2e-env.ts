/**
 * Log configuration for e2e runs — PINO_LOGGING_SPECIFICATION.md §15 and §38.
 *
 * Runs via Jest `setupFiles`, so these land in `process.env` *before* any
 * module is imported. That ordering matters twice over: `app.module.ts` calls
 * `dotenv.config()` at import time, and dotenv does not overwrite variables
 * that are already set — so setting them here is what makes the local
 * developer's `.env` (which uses `pretty` for readability) not leak into a
 * test that asserts on NDJSON.
 *
 * `LOG_LEVEL` is `info` rather than the `silent` §15 suggests, because the
 * logging suite's whole purpose is to assert on emitted output. Suites that
 * want quiet pass `logger: false` when creating their app.
 */
process.env.LOG_FORMAT = 'json';
process.env.LOG_PRETTY = 'false';
process.env.LOG_LEVEL = 'info';
process.env.LOG_REDACTION_ENABLED = 'true';
