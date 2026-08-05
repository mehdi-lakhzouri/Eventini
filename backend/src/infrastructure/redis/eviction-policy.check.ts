import type { RedisConnection } from './redis-connection.factory';

export const REQUIRED_MAXMEMORY_POLICY = 'noeviction';

export type EvictionPolicyVerdict =
  | { readonly outcome: 'CORRECT' }
  | { readonly outcome: 'WRONG'; readonly policy: string }
  | { readonly outcome: 'UNKNOWN' };

/**
 * Reads `maxmemory-policy` off the application database.
 *
 * Under `allkeys-lru` Redis is free to drop any key when memory runs short,
 * and it picks by access recency — which selects almost perfectly for the keys
 * that matter here. A lockout counter is written once and read rarely; a
 * distributed lock is written once and read never. They are the first things
 * an LRU sheds, and shedding them silently disables the control. Memory in
 * this deployment is bounded by TTLs instead: every key this application
 * writes has one (REDIS_KEYS_AND_LUA_SCRIPTS.md §2).
 *
 * `UNKNOWN` is a normal answer, not an error: §8 asks for `CONFIG` to be
 * renamed or disabled in production, so a hardened server refuses this read.
 * That is why a wrong policy is reported rather than fatal — the check cannot
 * be trusted to run everywhere, and a boot that fails only on the servers
 * where the check happens to work would be worse than a loud log.
 */
export async function readEvictionPolicy(
  redis: RedisConnection,
): Promise<EvictionPolicyVerdict> {
  const reply = await redis
    .configGet('maxmemory-policy')
    .catch(() => undefined);

  const policy = extractPolicy(reply);

  if (policy === undefined) {
    return { outcome: 'UNKNOWN' };
  }

  return policy === REQUIRED_MAXMEMORY_POLICY
    ? { outcome: 'CORRECT' }
    : { outcome: 'WRONG', policy };
}

/**
 * `CONFIG GET` answers a flat array in RESP2 and a map in RESP3, and
 * node-redis hands both through as-is depending on the negotiated protocol.
 */
function extractPolicy(reply: unknown): string | undefined {
  if (Array.isArray(reply)) {
    const [, value] = reply as unknown[];

    return typeof value === 'string' ? value : undefined;
  }

  if (reply instanceof Map) {
    const value: unknown = reply.get('maxmemory-policy');

    return typeof value === 'string' ? value : undefined;
  }

  if (typeof reply === 'object' && reply !== null) {
    const value: unknown = (reply as Record<string, unknown>)[
      'maxmemory-policy'
    ];

    return typeof value === 'string' ? value : undefined;
  }

  return undefined;
}
