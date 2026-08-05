import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';

import { LUA_SCRIPTS, type LuaScriptName } from './lua-scripts';
import { REDIS_APP } from './redis.tokens';
import type { RedisConnection } from './redis-connection.factory';

/** A Lua reply is always a flat array of integers or strings for our scripts. */
export type LuaReply = readonly (number | string)[];

/**
 * Loads the four scripts at boot, remembers their SHA, and runs them by SHA.
 *
 * `EVALSHA` rather than `EVAL` on every call: `EVAL` ships the whole script
 * body with each invocation, which on the login path means a few kilobytes per
 * request for no reason.
 *
 * The `NOSCRIPT` fallback is not defensive padding. Redis keeps its script
 * cache in memory only, so a restart, a failover onto a replica or an
 * administrative `SCRIPT FLUSH` empties it while this process is still up and
 * still holding SHAs. Without the fallback, every rate-limit check would fail
 * from that moment until the application was restarted — and on an
 * authentication route a failing rate-limit check is a 503.
 *
 * A load failure at boot is fatal (REDIS_KEYS_AND_LUA_SCRIPTS.md §6). This
 * throws from `onModuleInit`, which aborts `NestFactory.create` and lands in
 * `main.ts`'s `exitFatal`. Starting without these scripts would mean serving
 * `/auth/sessions` with no rate limiting at all, which is precisely the
 * condition invariant O-4 exists to prevent.
 */
@Injectable()
export class RedisScriptRegistry implements OnModuleInit {
  private readonly shaByName = new Map<LuaScriptName, string>();

  constructor(@Inject(REDIS_APP) private readonly redis: RedisConnection) {}

  async onModuleInit(): Promise<void> {
    await this.loadAll();
  }

  async run(
    name: LuaScriptName,
    keys: readonly string[],
    args: readonly string[],
  ): Promise<LuaReply> {
    const sha = this.shaByName.get(name) ?? (await this.load(name));
    const options = { keys: [...keys], arguments: [...args] };

    try {
      return asLuaReply(await this.redis.evalSha(sha, options));
    } catch (error: unknown) {
      if (!isNoScriptError(error)) {
        throw error;
      }

      // The cache was emptied under us. Re-load so the *next* call is an
      // EVALSHA again, then run this one with the body inline so the caller
      // never sees the miss.
      const reloaded = await this.load(name);

      return asLuaReply(
        await this.redis.evalSha(reloaded, options).catch(async () => {
          return this.redis.eval(LUA_SCRIPTS[name], options);
        }),
      );
    }
  }

  /** Exposed for the boot check; the SHAs are also what §5 of the spec records. */
  shaOf(name: LuaScriptName): string | undefined {
    return this.shaByName.get(name);
  }

  private async loadAll(): Promise<void> {
    for (const name of Object.keys(LUA_SCRIPTS) as LuaScriptName[]) {
      await this.load(name);
    }
  }

  private async load(name: LuaScriptName): Promise<string> {
    const sha = await this.redis.scriptLoad(LUA_SCRIPTS[name]);
    this.shaByName.set(name, sha);

    return sha;
  }
}

/**
 * Redis reports a missing script as an error whose message begins `NOSCRIPT`.
 * Matched on the message because node-redis surfaces server errors as a
 * generic `ErrorReply` with no code to switch on.
 */
function isNoScriptError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('NOSCRIPT');
}

function asLuaReply(reply: unknown): LuaReply {
  if (!Array.isArray(reply)) {
    throw new TypeError(
      `Lua script returned ${typeof reply}, expected an array reply`,
    );
  }

  return reply as LuaReply;
}
