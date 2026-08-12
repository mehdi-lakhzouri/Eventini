import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  type HealthCheckResult,
} from '@nestjs/terminus';

import { AppException } from '../../common/api/app-exception';
import type { FieldError } from '../../common/api/problem-details.types';
import { DatabaseHealthIndicator } from './database.health-indicator';
import { RedisHealthIndicator } from './redis.health-indicator';
import { StartupState } from './startup.state';
import { Public } from '../../common/decorators';

/**
 * Terminus throws a `ServiceUnavailableException` whose response body holds
 * `{ status, info, error, details }`. Only `error` lists the indicators that
 * are down, and each entry is `{ status: 'down', ...extra }`.
 *
 * Reads defensively: this is a foreign shape from a dependency, and a health
 * endpoint that throws while reporting a failure is worse than useless.
 */
function toFieldErrors(error: unknown): FieldError[] {
  if (!(error instanceof ServiceUnavailableException)) {
    return [];
  }

  const response = error.getResponse();
  if (typeof response !== 'object' || response === null) {
    return [];
  }

  const downed = (response as { error?: Record<string, unknown> }).error;
  if (typeof downed !== 'object' || downed === null) {
    return [];
  }

  return Object.entries(downed).map(([dependency, detail]): FieldError => {
    const reason =
      typeof detail === 'object' &&
      detail !== null &&
      typeof (detail as { reason?: unknown }).reason === 'string'
        ? (detail as { reason: string }).reason
        : 'unreachable';

    return {
      field: dependency,
      code: 'DEPENDENCY_DOWN',
      message: `${dependency} is ${reason}`,
    };
  });
}
/**
 * The three probes, which answer three different questions.
 *
 * | Route      | Question                        | Orchestrator's reaction to failure |
 * |------------|---------------------------------|------------------------------------|
 * | `/live`    | is the process still running?   | **kill and restart the container** |
 * | `/ready`   | can it serve traffic right now? | remove from the load-balancer pool |
 * | `/startup` | has initialisation finished?    | keep waiting, do not kill yet      |
 *
 * Conflating `live` with `ready` produces the restart loop this ticket and
 * REDIS_KEYS_AND_LUA_SCRIPTS.md §283 both call out: Redis goes down, `live`
 * fails, the orchestrator kills the pod, the pod restarts, Redis is still
 * down, repeat — turning a degraded but recoverable service into an outage,
 * and destroying the in-flight work of every replica on the way. With the
 * split, the same failure quietly removes the instance from routing and it
 * rejoins by itself when Redis returns.
 *
 * So `/live` deliberately checks **nothing**. Any dependency reachable from
 * it is a dependency whose outage can restart the fleet.
 */
/**
 * Public: liveness, readiness and scraping are called by the platform, not
 * by a user — a probe holds no session and a failing probe must report the
 * service's health rather than its own lack of credentials. Exempt from
 * CSRF and rate limiting for the same reason.
 */
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly startup: StartupState,
  ) {}

  /**
   * Liveness. Returning at all is the entire answer: if the event loop were
   * blocked or the process dead, this would not respond.
   */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Readiness.
   *
   * Terminus signals failure by throwing, and its exception carries the
   * per-indicator breakdown. Left alone, that throw reaches the global
   * `HttpExceptionFilter`, which maps any unrecognised exception to a bare
   * `DEPENDENCY_UNAVAILABLE` — correct status, but the breakdown is
   * discarded, so an operator learns that *a* dependency is missing and not
   * *which*. That is the entire diagnostic value of the probe, and it was
   * silently lost until an e2e test asserted on the body.
   *
   * So the failure is translated here into the project's own envelope: one
   * `errors[]` entry per downed dependency, which keeps a single response
   * contract across the API (ADR-0008) and still names the culprit.
   */
  @Get('ready')
  @HealthCheck()
  async ready(): Promise<HealthCheckResult> {
    try {
      return await this.health.check([
        () => this.database.isHealthy(),
        () => this.redis.isHealthy(),
      ]);
    } catch (error) {
      throw new AppException('DEPENDENCY_UNAVAILABLE', {
        detail: 'One or more dependencies are unavailable.',
        errors: toFieldErrors(error),
        // A dependency outage is transient by nature, and the caller here is
        // an orchestrator that will poll again regardless.
        retryable: true,
      });
    }
  }

  /**
   * Startup. Cheap and dependency-free by design: it answers whether the
   * container finished building, not whether anything downstream is well.
   * Mixing dependency checks in here would make a slow database look like a
   * failed boot and get the container killed during startup.
   */
  @Get('startup')
  startupProbe(): { status: 'ok' } {
    if (!this.startup.hasStarted) {
      throw new ServiceUnavailableException('Application is still starting');
    }

    return { status: 'ok' };
  }
}
