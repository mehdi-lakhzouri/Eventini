import { LUA_SCRIPTS } from './lua-scripts';
import type { RedisConnection } from './redis-connection.factory';
import { RedisScriptRegistry } from './redis-script.registry';

/**
 * A Redis stand-in that behaves like the real script cache: `EVALSHA` only
 * succeeds for a SHA that was loaded and not since flushed.
 */
class FakeRedis implements RedisConnection {
  readonly isReady = true;
  readonly loaded = new Set<string>();
  loadCount = 0;
  evalCount = 0;
  evalShaCount = 0;
  loadFailure: Error | undefined;

  // Not exercised by the registry, which only ever runs scripts. Declared so
  // the fake implements the port in full and a future method cannot be added
  // to the interface without this file noticing.
  get(): Promise<string | null> {
    return Promise.resolve(null);
  }

  set(): Promise<unknown> {
    return Promise.resolve('OK');
  }

  incr(): Promise<number> {
    return Promise.resolve(1);
  }

  pExpire(): Promise<unknown> {
    return Promise.resolve(1);
  }

  del(): Promise<number> {
    return Promise.resolve(0);
  }

  scriptLoad(script: string): Promise<string> {
    if (this.loadFailure) {
      return Promise.reject(this.loadFailure);
    }

    this.loadCount += 1;
    const sha = shaFor(script);
    this.loaded.add(sha);

    return Promise.resolve(sha);
  }

  evalSha(sha: string): Promise<unknown> {
    this.evalShaCount += 1;

    return this.loaded.has(sha)
      ? Promise.resolve([1, 2, 0])
      : Promise.reject(new Error('NOSCRIPT No matching script'));
  }

  eval(): Promise<unknown> {
    this.evalCount += 1;

    return Promise.resolve([1, 2, 0]);
  }

  ping(): Promise<string> {
    return Promise.resolve('PONG');
  }

  configGet(): Promise<unknown> {
    return Promise.resolve({ 'maxmemory-policy': 'noeviction' });
  }

  destroy(): void {}

  flushScripts(): void {
    this.loaded.clear();
  }
}

function shaFor(script: string): string {
  return `sha-${String(script.length)}-${script.slice(20, 40)}`;
}

describe('RedisScriptRegistry', () => {
  let redis: FakeRedis;
  let registry: RedisScriptRegistry;

  beforeEach(async () => {
    redis = new FakeRedis();
    registry = new RedisScriptRegistry(redis);
    await registry.onModuleInit();
  });

  it('loads all four scripts at boot', () => {
    expect(redis.loadCount).toBe(4);
    expect(registry.shaOf('RATE_LIMIT_SLIDING_WINDOW')).toBeDefined();
  });

  /**
   * Serving traffic without the rate limiter is invariant O-4's failure case,
   * so the container must refuse to finish building rather than come up
   * degraded.
   */
  it('refuses to start when a script cannot be loaded', async () => {
    const failing = new FakeRedis();
    failing.loadFailure = new Error('READONLY replica');

    await expect(
      new RedisScriptRegistry(failing).onModuleInit(),
    ).rejects.toThrow('READONLY replica');
  });

  it('runs by SHA rather than shipping the body', async () => {
    await registry.run('RATE_LIMIT_SLIDING_WINDOW', ['rl:k'], ['5']);

    expect(redis.evalShaCount).toBe(1);
    expect(redis.evalCount).toBe(0);
  });

  /**
   * The script cache lives in memory only: a Redis restart, a failover or an
   * administrative SCRIPT FLUSH empties it while this process still holds the
   * SHAs. Without the fallback every rate-limit check would fail from that
   * moment on — and on a login route a failing check is a 503.
   */
  it('recovers from an emptied script cache without surfacing the miss', async () => {
    redis.flushScripts();

    const reply = await registry.run(
      'RATE_LIMIT_SLIDING_WINDOW',
      ['rl:k'],
      ['5'],
    );

    expect(reply).toEqual([1, 2, 0]);
    expect(redis.loadCount).toBe(5);
  });

  it('is back on EVALSHA for the next call after a flush', async () => {
    redis.flushScripts();
    await registry.run('RATE_LIMIT_SLIDING_WINDOW', ['rl:k'], ['5']);

    const loadsAfterRecovery = redis.loadCount;
    await registry.run('RATE_LIMIT_SLIDING_WINDOW', ['rl:k'], ['5']);

    expect(redis.loadCount).toBe(loadsAfterRecovery);
  });

  it('propagates a failure that is not a cache miss', async () => {
    const broken = new FakeRedis();
    const brokenRegistry = new RedisScriptRegistry(broken);
    await brokenRegistry.onModuleInit();
    jest
      .spyOn(broken, 'evalSha')
      .mockRejectedValue(new Error('LOADING Redis is loading the dataset'));

    await expect(
      brokenRegistry.run('DISTRIBUTED_LOCK', ['lock:k'], ['acquire']),
    ).rejects.toThrow('LOADING');
  });

  it('gives each script a distinct SHA', () => {
    const shas = Object.keys(LUA_SCRIPTS).map((name) =>
      registry.shaOf(name as keyof typeof LUA_SCRIPTS),
    );

    expect(new Set(shas).size).toBe(4);
  });
});
