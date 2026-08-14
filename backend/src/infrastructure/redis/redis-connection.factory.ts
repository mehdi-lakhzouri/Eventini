import { createClient } from 'redis';

/**
 * The Redis surface the application actually uses, as a port.
 *
 * A narrow interface rather than node-redis's `RedisClientType`: everything
 * that talks to Redis in this codebase does so through the script registry or
 * one of the services above it, so the surface is genuinely this small — and
 * keeping it small is what lets those services be unit-tested against a fake
 * that fits in a dozen lines instead of a container and a live server.
 */
/**
 * Deliberately narrow: the surface a caller can reach is the surface a caller
 * can misuse, and anything that touches several keys atomically belongs in a
 * Lua script rather than in a sequence of calls from here.
 *
 * The plain commands below exist for the lockout store's single-key reads and
 * its detection counter, which have no atomicity requirement across keys.
 */
export interface RedisConnection {
  readonly isReady: boolean;
  scriptLoad(script: string): Promise<string>;
  evalSha(
    sha: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
  ping(): Promise<string>;
  configGet(parameter: string): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options?: { readonly PX: number },
  ): Promise<unknown>;
  incr(key: string): Promise<number>;
  pExpire(key: string, milliseconds: number): Promise<unknown>;
  del(keys: string[]): Promise<number>;
  destroy(): void;
}

export interface RedisConnectionSettings {
  readonly url: string;
  readonly database: number;
  readonly connectionName: string;
  readonly connectTimeoutMs: number;
  readonly maxRetries: number;
  readonly tlsEnabled: boolean;
}

/**
 * Opens one named connection.
 *
 * `database` overrides whatever path the URL carries, so the five connections
 * land on the databases §2 assigns them even when `REDIS_URL` is written
 * without one. Queue state and security counters on separate databases means a
 * `FLUSHDB` aimed at a stuck queue cannot take a lockout with it.
 *
 * ## Reconnecting forever, but never queueing
 *
 * The client keeps retrying instead of giving up after `maxRetries`. Every
 * authentication route fails closed when the rate limiter cannot reach Redis
 * (§7), so a client that stopped reconnecting would turn a thirty-second blip
 * into a total login outage lasting until someone restarted the process.
 * `maxRetries` bounds how far the delay doubles, not how many times it tries.
 *
 * `disableOfflineQueue` is what makes that safe. node-redis otherwise buffers
 * commands issued while the socket is down and replays them on reconnect —
 * so a rate-limit check would hang for the length of the outage instead of
 * failing, and the fail-open/fail-closed decision would never be reached. A
 * limiter that hangs is worse than either answer.
 */
export async function createRedisConnection(
  settings: RedisConnectionSettings,
): Promise<RedisConnection> {
  // `tls` is spread in rather than set to a boolean: node-redis discriminates
  // its socket options on the *presence* of the key, so `tls: false` selects
  // the TLS variant with TLS disabled and fails to typecheck as a TCP socket.
  const socket = {
    connectTimeout: settings.connectTimeoutMs,
    reconnectStrategy: (retries: number) =>
      Math.min(100 * 2 ** Math.min(retries, settings.maxRetries), 10_000),
    ...(settings.tlsEnabled ? { tls: true as const } : {}),
  };

  const client = createClient({
    url: settings.url,
    database: settings.database,
    name: settings.connectionName,
    disableOfflineQueue: true,
    socket,
  });

  // node-redis emits 'error' on the client itself; without a listener Node
  // treats it as an unhandled error event and kills the process, turning a
  // transient network blip into a crash.
  client.on('error', () => undefined);

  await client.connect();

  return client;
}
