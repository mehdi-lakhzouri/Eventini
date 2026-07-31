import pino, { type Logger } from 'pino';

import { REDACTION_PATHS, scrubSensitiveKeys } from './log-redaction.config';
import { REDACTED_PLACEHOLDER } from './logging.constants';

/**
 * A logger that exists before Nest does.
 *
 * §29 requires a `fatal` line for `uncaughtException`, `unhandledRejection`,
 * startup failure and invalid configuration. Three of those four can happen
 * *before* the DI container is built — an invalid environment throws inside
 * `NestFactory.create` itself — so the injected `Logger` is not available at
 * the moment it is most needed. `console.error` would satisfy nobody: §3.6
 * and §17 require NDJSON on stdout, and a plain string is exactly what a log
 * collector cannot parse or alert on.
 *
 * Configured from `process.env` directly and defensively, because by
 * definition it may be running *because* configuration validation failed.
 * Redaction is still applied: a startup failure message can quote the value
 * it choked on, and that value is sometimes a secret.
 */
export function createBootstrapLogger(): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: {
      service: process.env.LOG_SERVICE_NAME ?? 'eventini-api',
      serviceVersion: process.env.LOG_SERVICE_VERSION ?? '0.0.1',
      environment: process.env.NODE_ENV ?? 'development',
      instanceId: process.env.INSTANCE_ID ?? process.env.HOSTNAME ?? 'unknown',
    },
    formatters: {
      level: (label) => ({ level: label }),
      log: (object: Record<string, unknown>) =>
        scrubSensitiveKeys(object) as Record<string, unknown>,
    },
    redact: {
      paths: [...REDACTION_PATHS],
      censor: REDACTED_PLACEHOLDER,
    },
  });
}
