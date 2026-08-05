import { createClient } from 'redis';

import {
  createRedisConnection,
  type RedisConnection,
} from '../../src/infrastructure/redis/redis-connection.factory';
import { RedisScriptRegistry } from '../../src/infrastructure/redis/redis-script.registry';
import { redisKeys } from '../../src/infrastructure/redis/redis-key.builder';

const REDIS_URL = process.env.REDIS_URL;
const describeWithRedis = REDIS_URL ? describe : describe.skip;

/**
 * The registry against a real server. The unit suite proves the fallback logic
 * with a fake; this proves Redis actually behaves the way the fake assumes —
 * in particular that `EVALSHA` really fails with `NOSCRIPT` after a flush.
 */
describeWithRedis('RedisScriptRegistry against a live Redis', () => {
  let connection: RedisConnection;
  let admin: ReturnType<typeof createClient>;
  let registry: RedisScriptRegistry;

  const key = redisKeys.rateLimit.loginIp(`198.51.100.${String(Date.now() % 200)}`);

  beforeAll(async () => {
    connection = await createRedisConnection({
      url: REDIS_URL as string,
      database: 0,
      connectionName: 'eventini-integration',
      connectTimeoutMs: 5_000,
      maxRetries: 3,
      tlsEnabled: false,
    });

    admin = createClient({ url: REDIS_URL });
    admin.on('error', () => undefined);
    await admin.connect();

    registry = new RedisScriptRegistry(connection);
    await registry.onModuleInit();
  });

  afterAll(async () => {
    await admin.del(key);
    await admin.close();
    connection.destroy();
  });

  beforeEach(async () => {
    await admin.del(key);
  });

  function consume(now: number, member: string): Promise<readonly unknown[]> {
    return registry.run(
      'RATE_LIMIT_SLIDING_WINDOW',
      [key],
      ['3', '60000', String(now), member],
    );
  }

  it('loads every script and remembers a SHA for each', () => {
    expect(registry.shaOf('RATE_LIMIT_SLIDING_WINDOW')).toMatch(/^[0-9a-f]{40}$/);
    expect(registry.shaOf('LOCKOUT_REGISTER_FAILURE')).toMatch(/^[0-9a-f]{40}$/);
    expect(registry.shaOf('ANTI_REPLAY_CLAIM')).toMatch(/^[0-9a-f]{40}$/);
    expect(registry.shaOf('DISTRIBUTED_LOCK')).toMatch(/^[0-9a-f]{40}$/);
  });

  it('enforces the limit exactly at the boundary', async () => {
    const now = Date.now();

    await expect(consume(now, 'm1')).resolves.toEqual([1, 2, 0]);
    await expect(consume(now + 1, 'm2')).resolves.toEqual([1, 1, 0]);
    await expect(consume(now + 2, 'm3')).resolves.toEqual([1, 0, 0]);

    const rejected = await consume(now + 3, 'm4');
    expect(rejected[0]).toBe(0);
    expect(Number(rejected[2])).toBeGreaterThanOrEqual(1);
  });

  /** §9 test 11: a key without a TTL is a leak that outlives its window. */
  it('leaves a TTL on every key it writes', async () => {
    await consume(Date.now(), 'ttl');

    const ttl = await admin.pTTL(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });

  /**
   * §9 test 12. Redis keeps its script cache in memory only, so a restart, a
   * failover or an administrative flush empties it under a running process.
   */
  it('survives a SCRIPT FLUSH without surfacing an error', async () => {
    await admin.scriptFlush();

    await expect(consume(Date.now(), 'after-flush')).resolves.toEqual([
      1, 2, 0,
    ]);
    expect(registry.shaOf('RATE_LIMIT_SLIDING_WINDOW')).toMatch(
      /^[0-9a-f]{40}$/,
    );
  });
});
