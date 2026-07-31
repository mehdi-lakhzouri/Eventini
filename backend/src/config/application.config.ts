import { registerAs } from '@nestjs/config';

import { getValidatedEnv } from './validated-env';

/**
 * Application-level settings.
 *
 * Every namespace in this directory reads from `getValidatedEnv()`, never from
 * `process.env` directly — see `validated-env.ts` for why: `process.env` can
 * only hold strings, so a direct cast silently turns every number, boolean
 * and array field back into raw text.
 */
export const applicationConfig = registerAs('application', () => {
  const env = getValidatedEnv();

  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    port: env.PORT,
    apiBaseUrl: env.API_BASE_URL,
    webBaseUrl: env.WEB_BASE_URL,
    // A hop count, never a boolean. See coherence rule 6.
    trustedProxyHops: env.TRUSTED_PROXY_HOPS,
    shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    swaggerEnabled: env.SWAGGER_ENABLED,
    corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS,
    corsMaxAgeSeconds: env.CORS_MAX_AGE_SECONDS,
    bodyLimitJson: env.BODY_LIMIT_JSON,
    bodyLimitImport: env.BODY_LIMIT_IMPORT,
  };
});
