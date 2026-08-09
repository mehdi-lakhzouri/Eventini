import { readEvictionPolicy } from './eviction-policy.check';
import type { RedisConnection } from './redis-connection.factory';

function connectionAnswering(reply: unknown): RedisConnection {
  return {
    isReady: true,
    scriptLoad: () => Promise.resolve('sha'),
    evalSha: () => Promise.resolve([]),
    eval: () => Promise.resolve([]),
    ping: () => Promise.resolve('PONG'),
    configGet: () => Promise.resolve(reply),
    // Unused here; present so the fake satisfies the whole port rather than
    // the slice this file happens to exercise.
    get: () => Promise.resolve(null),
    set: () => Promise.resolve('OK'),
    incr: () => Promise.resolve(1),
    pExpire: () => Promise.resolve(1),
    del: () => Promise.resolve(0),
    destroy: () => undefined,
  };
}

describe('readEvictionPolicy', () => {
  it('accepts noeviction', async () => {
    await expect(
      readEvictionPolicy(
        connectionAnswering({ 'maxmemory-policy': 'noeviction' }),
      ),
    ).resolves.toEqual({ outcome: 'CORRECT' });
  });

  /**
   * An LRU sheds the least recently *used* keys first, and a lockout counter
   * is written once and read rarely — it is close to the ideal eviction
   * candidate. The control would disappear exactly when the server is under
   * the load an attack produces.
   */
  it('reports a policy that can evict a security control', async () => {
    await expect(
      readEvictionPolicy(
        connectionAnswering({ 'maxmemory-policy': 'allkeys-lru' }),
      ),
    ).resolves.toEqual({ outcome: 'WRONG', policy: 'allkeys-lru' });
  });

  it('reads the RESP2 array form', async () => {
    await expect(
      readEvictionPolicy(
        connectionAnswering(['maxmemory-policy', 'noeviction']),
      ),
    ).resolves.toEqual({ outcome: 'CORRECT' });
  });

  it('reads the RESP3 map form', async () => {
    await expect(
      readEvictionPolicy(
        connectionAnswering(new Map([['maxmemory-policy', 'volatile-ttl']])),
      ),
    ).resolves.toEqual({ outcome: 'WRONG', policy: 'volatile-ttl' });
  });

  /** §8 asks for CONFIG to be disabled in production, so this is expected. */
  it('reports unknown rather than failing when CONFIG is refused', async () => {
    const refusing: RedisConnection = {
      ...connectionAnswering(undefined),
      configGet: () => Promise.reject(new Error('ERR unknown command')),
    };

    await expect(readEvictionPolicy(refusing)).resolves.toEqual({
      outcome: 'UNKNOWN',
    });
  });
});
