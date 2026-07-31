import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './prisma/generated/client';

export interface PrismaConnectionSettings {
  readonly url: string;
  readonly poolSize: number;
  readonly connectTimeoutMs: number;
  readonly statementTimeoutMs: number;
}

/**
 * The application's single `PrismaClient` — sprint-03 EVT-014.
 *
 * ## Why a driver adapter is not optional here
 *
 * Prisma 7 runs on the query compiler, and its `PrismaClient` no longer
 * carries a native connection layer: it takes a driver adapter. `PrismaPg`
 * wraps a `pg` pool, which is what lets the pool be tuned from the validated
 * environment rather than from Prisma's defaults — `DATABASE_POOL_SIZE`,
 * `DATABASE_CONNECT_TIMEOUT_MS` and `DATABASE_STATEMENT_TIMEOUT_MS` all exist
 * in the schema since EVT-008 and would otherwise have been decorative.
 *
 * `statement_timeout` is applied per connection rather than per query: one
 * pathological plan must not be able to hold a connection open indefinitely
 * during an event, when every scanner in the venue is contending for the
 * pool.
 *
 * ## Lifecycle
 *
 * `onModuleInit` connects eagerly instead of letting the first query do it.
 * A lazy connect would turn a bad `DATABASE_URL` into a 500 on whichever
 * request happened to arrive first, long after startup, rather than a
 * failure at boot where the orchestrator can act on it — the same
 * fail-closed reasoning as the environment validation.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(settings: PrismaConnectionSettings) {
    super({
      adapter: new PrismaPg({
        connectionString: settings.url,
        max: settings.poolSize,
        connectionTimeoutMillis: settings.connectTimeoutMs,
        // Enforced by PostgreSQL itself, so it holds even for a query issued
        // outside the service layer.
        options: `-c statement_timeout=${settings.statementTimeoutMs}`,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    // Runs through Nest's shutdown hooks (enabled in main.ts), so a SIGTERM
    // drains the pool rather than dropping connections mid-transaction.
    await this.$disconnect();
  }
}
