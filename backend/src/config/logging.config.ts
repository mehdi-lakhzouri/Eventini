import { registerAs } from '@nestjs/config';

import { getValidatedEnv } from './validated-env';

/**
 * Logging settings — PINO_LOGGING_SPECIFICATION.md §38.
 *
 * `instanceId` falls back to the hostname, which under Docker and Kubernetes
 * is the container/pod name: §9.1 wants the field on every line so a log store
 * can separate two replicas, and requiring an operator to set it by hand would
 * mean it is usually unset exactly when it matters.
 */
export const loggingConfig = registerAs('logging', () => {
  const env = getValidatedEnv();

  return {
    level: env.LOG_LEVEL,
    format: env.LOG_FORMAT,
    pretty: env.LOG_PRETTY,
    serviceName: env.LOG_SERVICE_NAME,
    serviceVersion: env.LOG_SERVICE_VERSION,
    redactionEnabled: env.LOG_REDACTION_ENABLED,
    httpEnabled: env.LOG_HTTP_ENABLED,
    httpSuccessEnabled: env.LOG_HTTP_SUCCESS_ENABLED,
    slowRequestThresholdMs: env.LOG_SLOW_REQUEST_THRESHOLD_MS,
    slowQueryThresholdMs: env.LOG_SLOW_QUERY_THRESHOLD_MS,
    debugModules: env.LOG_DEBUG_MODULES,
    debugExpiresAt: env.LOG_DEBUG_EXPIRES_AT,
    environment: env.NODE_ENV,
    instanceId: env.INSTANCE_ID ?? process.env.HOSTNAME ?? 'unknown',
  };
});
