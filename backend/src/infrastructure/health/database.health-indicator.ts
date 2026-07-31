import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { Pool } from 'pg';

import { probeDependency } from './dependency-probe';
import { DATABASE_INDICATOR_KEY } from './health.constants';

/**
 * Readiness check for PostgreSQL.
 *
 * Runs `SELECT 1` over a real pooled connection, which is the smallest query
 * that proves the whole path — DNS, TCP, TLS, authentication and the database
 * accepting queries. A TCP connect alone would report a server that is
 * listening but rejecting logins as healthy, which is precisely the state
 * readiness exists to catch.
 *
 * ## Why this owns a pool instead of using Prisma
 *
 * `PrismaService` arrives in EVT-014 (sprint 03). Rather than block readiness
 * until then, this holds a deliberately tiny `pg` pool of its own: `max: 1`,
 * because a probe needs exactly one connection and must never compete with
 * application traffic for it.
 *
 * The pool is reused across probes on purpose. Connecting per probe would
 * mean a fresh TCP handshake and authentication every few seconds from every
 * replica, which is load the database does not need and which makes the probe
 * measure connection setup rather than database health.
 *
 * TODO(EVT-014, sprint 03): once `PrismaService` exists, inject it and drop
 * this pool, so there is one connection configuration rather than two.
 */
@Injectable()
export class DatabaseHealthIndicator implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    connectionString: string,
  ) {
    this.pool = new Pool({
      connectionString,
      max: 1,
      // Bounded so a probe cannot inherit the driver's default multi-second
      // connect timeout and outlive the probe's own deadline.
      connectionTimeoutMillis: 1_500,
      idleTimeoutMillis: 30_000,
      allowExitOnIdle: true,
    });

    // An idle pool emits 'error' when the server closes a connection. Without
    // a listener that is an unhandled 'error' event, which in Node terminates
    // the process — a health check must never be the thing that kills the
    // service it reports on.
    this.pool.on('error', () => undefined);
  }

  async isHealthy(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(DATABASE_INDICATOR_KEY);

    const outcome = await probeDependency(() => this.pool.query('SELECT 1'));

    return outcome.ok
      ? indicator.up({ durationMs: outcome.durationMs })
      : indicator.down({
          durationMs: outcome.durationMs,
          // A classification, never the driver's message: that text carries
          // the connection string, and this is served over HTTP.
          reason: outcome.reason ?? 'unreachable',
        });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
