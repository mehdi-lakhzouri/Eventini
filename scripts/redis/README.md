# Redis Lua scripts

Atomic operations that a check-then-act sequence would get wrong.

Full specification: [`docs/infrastructure/REDIS_KEYS_AND_LUA_SCRIPTS.md`](../../docs/infrastructure/REDIS_KEYS_AND_LUA_SCRIPTS.md)
Decision record: [ADR-0011](../../docs/adr/0011-redis-lua-atomic-operations.md)

| Script | Purpose |
|---|---|
| `rate-limit-sliding-window.lua` | Sliding-window rate limiter (ZSET). One round trip, exact at the boundary |
| `lockout-register-failure.lua` | Progressive lockout ladder. Key must be `ip+email`, never `email` alone |
| `anti-replay-claim.lua` | Single-use nonce claim, returns the original claimant on replay |
| `distributed-lock.lua` | Fenced acquire/release/extend. A non-owner can never release |

## Rules

1. **Keys only arrive via `KEYS`.** Never build a key inside a script — it breaks Redis Cluster slot routing.
2. **No non-deterministic commands.** No `TIME`, `RANDOMKEY`, `SRANDMEMBER`. The caller passes `now_ms` so the application is the single clock source.
3. **Short, no unbounded loops.** A running script blocks the entire Redis server.
4. **Versioned in the header. An incompatible change creates a NEW file** — it never edits an existing one. An in-flight `EVALSHA` during a rolling deploy must never change meaning.
5. Loaded with `SCRIPT LOAD` at boot, called with `EVALSHA`, falling back to `EVAL` on `NOSCRIPT`.

## Running them

```bash
docker cp scripts/redis/. eventini-redis:/scripts/

docker exec eventini-redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning \
  --eval /scripts/rate-limit-sliding-window.lua rl:demo , 3 60000 1785268800001 m1
# => 1) (integer) 1   allowed
#    2) (integer) 2   remaining
#    3) (integer) 0   retry_after
```

Note the `,` separating `KEYS` from `ARGV` in `redis-cli --eval`. Omitting it passes everything as keys.

Verified output for all four scripts against Redis 8.8: see §5 of the specification.

## Status

These scripts are **specification artifacts**. They are not yet wired into the application — `backend/src/infrastructure/redis/index.ts` currently contains `export {};`. Integration lands in sprint 05.
