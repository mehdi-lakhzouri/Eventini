import { Inject, Injectable } from '@nestjs/common';
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';

import { TENANT_SCOPED_PRISMA } from '../database/prisma.tokens';
import type { TenantScopedPrismaClient } from '../database/tenant-scope.extension';
import { probeDependency } from './dependency-probe';
import { DATABASE_INDICATOR_KEY } from './health.constants';

/**
 * Readiness check for PostgreSQL.
 *
 * Runs `SELECT 1` through the application's own `PrismaService`, which is the
 * smallest query proving the whole path — DNS, TCP, TLS, authentication and
 * the database accepting queries. A TCP connect alone would report a server
 * that is listening but rejecting logins as healthy, which is precisely the
 * state readiness exists to catch. Confirmed in EVT-012: a stale password in
 * `.env` produced exactly that, and only the query caught it.
 *
 * ## Why it shares the application's client (EVT-014)
 *
 * Until `PrismaService` existed this held a separate one-connection `pg` pool
 * of its own. That was the right stopgap and the wrong end state: two
 * connection configurations mean readiness can pass against settings the
 * application does not use, so a wrong pool size, timeout or TLS option would
 * be invisible to the probe that exists to notice it.
 *
 * Sharing the pool costs one connection from it per probe, briefly. That is
 * the intended trade: a probe that measures the real client is worth more
 * than one that measures a private connection nothing else uses.
 */
@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    /**
     * The tenant-scoped client (EVT-018), because `PrismaModule` no longer
     * exports the raw one — an unguarded client that anything can inject is a
     * way around ADR-0003, and readiness is not a good enough reason to keep
     * one. `SELECT 1` is raw SQL, so it never reaches the guard anyway; the
     * probe still measures the application's real pool, which is the property
     * EVT-014 bought here.
     */
    @Inject(TENANT_SCOPED_PRISMA)
    private readonly prisma: TenantScopedPrismaClient,
  ) {}

  async isHealthy(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(DATABASE_INDICATOR_KEY);

    const outcome = await probeDependency(
      () => this.prisma.$queryRaw`SELECT 1`,
    );

    return outcome.ok
      ? indicator.up({ durationMs: outcome.durationMs })
      : indicator.down({
          durationMs: outcome.durationMs,
          // A classification, never the driver's message: that text carries
          // the connection string, and this is served over HTTP.
          reason: outcome.reason ?? 'unreachable',
        });
  }
}
