import { config as loadDotenvFile } from 'dotenv';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../src/infrastructure/database/prisma/generated/client';

/**
 * The `PrismaClient` the seed runs on — sprint-03 EVT-017.
 *
 * Built here rather than reused from `PrismaService` for one reason: the seed
 * runs under `ts-node`, outside Nest. There is no injector, no lifecycle and
 * no `ConfigModule`, so `PrismaService`'s constructor contract — a
 * `PrismaConnectionSettings` assembled from the validated environment — cannot
 * be satisfied without booting the application. Booting the whole application
 * to write reference data would also start the HTTP server, the metrics
 * registry and the health checks, none of which the seed needs.
 *
 * The pool is deliberately small. A seed is a single sequential script; more
 * than a couple of connections buys nothing and, on a managed database with a
 * low connection cap, competes with the application that is already running.
 */

/** Only the client type is exported; the seed steps never construct their own. */
export type SeedClient = PrismaClient;

const SEED_POOL_SIZE = 2;
const SEED_CONNECT_TIMEOUT_MS = 10_000;

/**
 * A seed statement is slower than a request handler's — reconciling
 * `role_permissions` touches every row of the table — so the application's
 * `DATABASE_STATEMENT_TIMEOUT_MS` would be the wrong bound here. It is still
 * bounded: an unbounded seed that hangs against a locked table looks
 * identical to one that is working.
 */
const SEED_STATEMENT_TIMEOUT_MS = 60_000;

export function readDatabaseUrl(): string {
  // Deployed environments inject real variables; .env is a local-development
  // convenience. Same rule as app.module.ts, for the same reason — a stray
  // file must not be able to redirect a production seed at another database.
  if (process.env['NODE_ENV'] !== 'production') {
    loadDotenvFile({ path: '.env' });
  }

  const url = process.env['DATABASE_URL'];

  if (url === undefined || url.trim() === '') {
    throw new Error(
      'DATABASE_URL is not set. The seed writes reference data to a real ' +
        'database and has no default to fall back on.',
    );
  }

  return url;
}

export function createSeedClient(url: string): SeedClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url,
      max: SEED_POOL_SIZE,
      connectionTimeoutMillis: SEED_CONNECT_TIMEOUT_MS,
      options: `-c statement_timeout=${SEED_STATEMENT_TIMEOUT_MS}`,
    }),
  });
}
