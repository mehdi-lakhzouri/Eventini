import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { createClient, type RedisClientType } from 'redis';

import { probeDependency } from './dependency-probe';
import { REDIS_INDICATOR_KEY } from './health.constants';

/**
 * Readiness check for Redis.
 *
 * `PING` is the canonical liveness command and proves connectivity plus
 * authentication without touching a key, so a probe can never disturb
 * application state.
 *
 * ## Connecting lazily, and why failure here is not fatal
 *
 * The client connects on first probe rather than at construction. A readiness
 * indicator that throws while the container is being built would abort
 * startup — turning "Redis is briefly unavailable" into "the service will not
 * boot", which is the restart loop the live/ready split exists to prevent
 * (REDIS_KEYS_AND_LUA_SCRIPTS.md §283: `/health/ready` fails while
 * `/health/live` stays green).
 *
 * `reconnectStrategy: false` keeps a failed probe from leaving a client
 * retrying forever in the background; each probe re-establishes if needed and
 * reports what it found.
 *
 * TODO(EVT-016, sprint 03): replace with the shared Redis provider once the
 * five-connection topology lands, so probe and application share one config.
 */
@Injectable()
export class RedisHealthIndicator implements OnModuleDestroy {
  private client: RedisClientType | undefined;

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly url: string,
  ) {}

  async isHealthy(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(REDIS_INDICATOR_KEY);

    const outcome = await probeDependency(async () => {
      const client = await this.connectedClient();
      return client.ping();
    });

    if (outcome.ok) {
      return indicator.up({ durationMs: outcome.durationMs });
    }

    // Drop a client that failed so the next probe starts clean rather than
    // reusing a socket that is already known to be broken.
    this.disposeClient();

    return indicator.down({
      durationMs: outcome.durationMs,
      reason: outcome.reason ?? 'unreachable',
    });
  }

  private async connectedClient(): Promise<RedisClientType> {
    if (this.client?.isReady === true) {
      return this.client;
    }

    const client = createClient({
      url: this.url,
      socket: { reconnectStrategy: false },
    }) as RedisClientType;

    // Without a listener, a connection error is an unhandled 'error' event,
    // which terminates the process.
    client.on('error', () => undefined);

    await client.connect();
    this.client = client;
    return client;
  }

  /**
   * `destroy()` rather than `close()`, and synchronous because node-redis
   * declares it that way: `close()` returns a promise because it drains
   * in-flight commands first, which is the wrong behaviour for a socket that
   * has just failed a probe — it would wait on a connection that is already
   * gone. `destroy()` tears the socket down immediately.
   */
  private disposeClient(): void {
    const client = this.client;
    this.client = undefined;

    if (!client) {
      return;
    }

    try {
      client.destroy();
    } catch {
      // Already broken; there is nothing useful left to do or report.
    }
  }

  onModuleDestroy(): void {
    this.disposeClient();
  }
}
