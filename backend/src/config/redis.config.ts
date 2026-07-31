import { registerAs } from '@nestjs/config';

import { getValidatedEnv } from './validated-env';

/**
 * Redis holds only temporary state. It is never the source of truth for
 * sessions, memberships, refresh-token state or audit
 * (REDIS_KEYS_AND_LUA_SCRIPTS.md §1).
 */
export const redisConfig = registerAs('redis', () => {
  const env = getValidatedEnv();

  return {
    url: env.REDIS_URL,
    queueDb: env.REDIS_QUEUE_DB,
    pubsubDb: env.REDIS_PUBSUB_DB,
    tlsEnabled: env.REDIS_TLS_ENABLED,
    connectTimeoutMs: env.REDIS_CONNECT_TIMEOUT_MS,
    maxRetries: env.REDIS_MAX_RETRIES,
  };
});
