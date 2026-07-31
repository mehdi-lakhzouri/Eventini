import type { ConfigType } from '@nestjs/config';
import type { LoggerOptions } from 'pino';

import type { loggingConfig } from '../../config/logging.config';
import { REDACTED_PLACEHOLDER } from './logging.constants';
import { REDACTION_PATHS, scrubSensitiveKeys } from './log-redaction.config';
import { LOG_SERIALIZERS } from './log-serializers';

export type LoggingSettings = ConfigType<typeof loggingConfig>;

/**
 * Builds the Pino options — §14 to §17 (per-environment configuration) and §9
 * (canonical schema).
 *
 * Pretty printing is allowed only when it was *both* asked for and the format
 * is `pretty`. §17 forbids it in production outright, and the environment
 * rules already refuse a production boot that sets it, so this is the second
 * of the two gates rather than the only one.
 */
export function buildPinoOptions(settings: LoggingSettings): LoggerOptions {
  const usePretty = settings.pretty && settings.format === 'pretty';

  const options: LoggerOptions = {
    level: settings.level,

    // §9.1 — the global fields that must appear on every line.
    base: {
      service: settings.serviceName,
      serviceVersion: settings.serviceVersion,
      environment: settings.environment,
      instanceId: settings.instanceId,
    },

    // §9 shows `time` as epoch millis; Pino's default is the same shape.
    timestamp: true,

    formatters: {
      // Emit the level as its name (`"info"`) rather than the numeric 30.
      // §6 documents both, and a name is what an operator greps for.
      level: (label) => ({ level: label }),
      ...(settings.redactionEnabled
        ? {
            log: (object: Record<string, unknown>) =>
              scrubSensitiveKeys(object) as Record<string, unknown>,
          }
        : {}),
    },

    serializers: LOG_SERIALIZERS,
  };

  if (settings.redactionEnabled) {
    options.redact = {
      paths: [...REDACTION_PATHS],
      censor: REDACTED_PLACEHOLDER,
      // Headers are *removed*, not censored, per §30's preference for
      // deletion over masking on transport credentials.
      remove: false,
    };
  }

  if (usePretty) {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        // §14's desired shape: `21:30:22 INFO [AuthenticationService] msg`.
        messageFormat: '[{context}] {msg}',
        ignore: 'pid,hostname,service,serviceVersion,environment,instanceId',
        singleLine: false,
      },
    };
  }

  return options;
}
