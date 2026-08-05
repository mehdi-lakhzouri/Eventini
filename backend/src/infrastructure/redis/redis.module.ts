import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
  type Provider,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { redisConfig } from '../../config/redis.config';
import { readEvictionPolicy } from './eviction-policy.check';
import {
  createRedisConnection,
  type RedisConnection,
} from './redis-connection.factory';
import { RedisScriptRegistry } from './redis-script.registry';
import {
  REDIS_APP,
  REDIS_BULLMQ_PRODUCER,
  REDIS_BULLMQ_WORKER,
  REDIS_CONNECTION_LABELS,
  REDIS_CONNECTION_TOKENS,
  REDIS_PUBSUB_PUBLISHER,
  REDIS_PUBSUB_SUBSCRIBER,
} from './redis.tokens';

type RedisSettings = ConfigType<typeof redisConfig>;

const APPLICATION_DATABASE = 0;

function connectionProvider(
  token: symbol,
  database: (settings: RedisSettings) => number,
): Provider {
  return {
    provide: token,
    inject: [redisConfig.KEY],
    useFactory: (settings: RedisSettings) =>
      createRedisConnection({
        url: settings.url,
        database: database(settings),
        connectionName: REDIS_CONNECTION_LABELS[token] ?? 'eventini',
        connectTimeoutMs: settings.connectTimeoutMs,
        maxRetries: settings.maxRetries,
        tlsEnabled: settings.tlsEnabled,
      }),
  };
}

/**
 * The five connections of REDIS_KEYS_AND_LUA_SCRIPTS.md §2, plus the script
 * registry that every atomic operation goes through.
 *
 * Global, for the same reason `PrismaModule` is: a connection is a process-wide
 * resource, and a module that forgets the import would open its own — five
 * connections would quietly become nine, each with its own reconnect
 * behaviour.
 *
 * Connections are opened eagerly. A lazy connection would move the first
 * failure into the first request, and on `/auth/sessions` the first request is
 * exactly where a Redis problem must not be discovered.
 */
@Global()
@Module({
  providers: [
    connectionProvider(REDIS_APP, () => APPLICATION_DATABASE),
    connectionProvider(REDIS_BULLMQ_PRODUCER, (settings) => settings.queueDb),
    connectionProvider(REDIS_BULLMQ_WORKER, (settings) => settings.queueDb),
    connectionProvider(REDIS_PUBSUB_PUBLISHER, (settings) => settings.pubsubDb),
    connectionProvider(
      REDIS_PUBSUB_SUBSCRIBER,
      (settings) => settings.pubsubDb,
    ),
    RedisScriptRegistry,
  ],
  exports: [...REDIS_CONNECTION_TOKENS, RedisScriptRegistry],
})
export class RedisModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisModule.name);

  constructor(
    @Inject(REDIS_APP) private readonly app: RedisConnection,
    @Inject(REDIS_BULLMQ_PRODUCER) private readonly producer: RedisConnection,
    @Inject(REDIS_BULLMQ_WORKER) private readonly worker: RedisConnection,
    @Inject(REDIS_PUBSUB_PUBLISHER) private readonly publisher: RedisConnection,
    @Inject(REDIS_PUBSUB_SUBSCRIBER)
    private readonly subscriber: RedisConnection,
  ) {}

  async onModuleInit(): Promise<void> {
    const verdict = await readEvictionPolicy(this.app);

    if (verdict.outcome === 'WRONG') {
      this.logger.error({
        category: 'CACHE',
        eventCode: 'REDIS_CONNECTED',
        maxmemoryPolicy: verdict.policy,
        msg: 'Redis may evict keys: a lockout counter or a lock can disappear under memory pressure. Set maxmemory-policy to noeviction.',
      });

      return;
    }

    this.logger.log({
      category: 'CACHE',
      eventCode: 'REDIS_CONNECTED',
      maxmemoryPolicy:
        verdict.outcome === 'CORRECT' ? 'noeviction' : 'unverifiable',
      msg: 'Redis connections established',
    });
  }

  /**
   * `destroy()` rather than `close()`: `close()` drains in-flight commands
   * first, and shutdown is exactly when the far end may already be gone — the
   * drain would then wait out the shutdown grace period and turn a clean stop
   * into a SIGKILL.
   */
  onApplicationShutdown(): void {
    for (const connection of [
      this.app,
      this.producer,
      this.worker,
      this.publisher,
      this.subscriber,
    ]) {
      try {
        connection.destroy();
      } catch {
        // Already gone; there is nothing useful left to do or report.
      }
    }
  }
}
