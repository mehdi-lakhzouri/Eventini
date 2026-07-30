import { registerAs } from '@nestjs/config';

import type { Env } from './env.schema';

export const databaseConfig = registerAs('database', () => {
  const env = process.env as unknown as Env;

  return {
    url: env.DATABASE_URL,
    shadowUrl: env.SHADOW_DATABASE_URL,
    poolSize: env.DATABASE_POOL_SIZE,
    connectTimeoutMs: env.DATABASE_CONNECT_TIMEOUT_MS,
    // Bounds pathological queries so one bad plan cannot hold a connection open
    // indefinitely during an event.
    statementTimeoutMs: env.DATABASE_STATEMENT_TIMEOUT_MS,
    slowQueryThresholdMs: env.DATABASE_SLOW_QUERY_THRESHOLD_MS,
  };
});
