/**
 * The four Lua sources of `scripts/redis/`, embedded verbatim.
 *
 * They are duplicated here rather than read from disk because the runtime
 * image contains `dist/` and `node_modules/` and nothing else — a script read
 * from a repository path at boot would work in development and fail the
 * container on its first start, and the failure is defined as fatal
 * (REDIS_KEYS_AND_LUA_SCRIPTS.md §6), so it would be a boot loop.
 *
 * `lua-scripts.spec.ts` asserts byte-for-byte equality with the files in
 * `scripts/redis/`, which is what keeps "duplicated" from becoming "diverged".
 * The CI job that executes those files and the application therefore run the
 * same bytes, and an edit to either side fails the unit suite.
 *
 * Generated content — edit `scripts/redis/*.lua`, never this file.
 */
export const LUA_SCRIPTS = {
  RATE_LIMIT_SLIDING_WINDOW: `--[[
  eventini:rate-limit-sliding-window  v1
  ---------------------------------------------------------------------------
  Sliding-window rate limiter backed by a sorted set.

  Chosen over a fixed window because a fixed window allows up to 2x the limit
  across a boundary (5 hits at 14m59s + 5 hits at 15m01s). On a login endpoint
  that difference matters.

  KEYS[1]  window key            e.g. rl:login_ip_email:1a2b3c...
  ARGV[1]  limit                 max entries allowed in the window
  ARGV[2]  window_ms             window length in milliseconds
  ARGV[3]  now_ms                caller clock, milliseconds since epoch
  ARGV[4]  member                unique member id for this request (uuid/ulid)

  RETURN   { allowed, remaining, retry_after_seconds }
             allowed  1 = accepted, 0 = rejected
             remaining  slots left after this call (0 when rejected)
             retry_after_seconds  0 when allowed; >=1 when rejected

  Notes
    - Deterministic: no TIME, no RANDOMKEY. Safe to replicate.
    - Single key, so it is Redis Cluster safe.
    - PEXPIRE is refreshed on every accepted call, so the key cannot outlive
      the window and cannot leak.
    - The caller supplies now_ms so that all app instances share one clock
      source (the app), not each Redis node's clock.
--]]

local key       = KEYS[1]
local limit     = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local now_ms    = tonumber(ARGV[3])
local member    = ARGV[4]

if not limit or not window_ms or not now_ms then
  return redis.error_reply('eventini: limit, window_ms and now_ms must be numbers')
end
if limit <= 0 or window_ms <= 0 then
  return redis.error_reply('eventini: limit and window_ms must be positive')
end

-- Drop everything that fell out of the window.
redis.call('ZREMRANGEBYSCORE', key, 0, now_ms - window_ms)

local used = redis.call('ZCARD', key)

if used >= limit then
  -- Rejected. Retry-After is derived from the oldest surviving entry: that is
  -- the moment a slot actually frees up.
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry_after = 1
  if oldest[2] then
    local free_at_ms = tonumber(oldest[2]) + window_ms
    retry_after = math.ceil((free_at_ms - now_ms) / 1000)
    if retry_after < 1 then retry_after = 1 end
  end
  -- Keep the TTL honest even on a rejected call.
  redis.call('PEXPIRE', key, window_ms)
  return { 0, 0, retry_after }
end

redis.call('ZADD', key, now_ms, member)
redis.call('PEXPIRE', key, window_ms)

return { 1, limit - used - 1, 0 }
`,

  LOCKOUT_REGISTER_FAILURE: `--[[
  eventini:lockout-register-failure  v1
  ---------------------------------------------------------------------------
  Records one authentication failure and applies the progressive lockout ladder
  atomically.

  The ladder (ADR-0013):
      5 consecutive failures -> 15 min
     10 consecutive failures ->  1 h
     15 consecutive failures -> 24 h

  The key MUST be scoped to ip+email, never to email alone. Locking on the
  email alone lets an attacker lock any user out by guessing their address:
  the security control becomes the denial of service. See ADR-0013 section 5.2.

  KEYS[1]  counter key            lockout:{ip}:{emailHash}
  KEYS[2]  lock key               lockout:lock:{ip}:{emailHash}
  ARGV[1]  now_ms
  ARGV[2]  counter_ttl_ms         how long consecutive failures accumulate
  ARGV[3]  thresholds_csv         "5,10,15"
  ARGV[4]  durations_ms_csv       "900000,3600000,86400000"

  RETURN   { locked, locked_until_ms, attempts }
             locked  1 = currently locked, 0 = not locked
             locked_until_ms  0 when not locked
             attempts  consecutive failure count after this call

  Notes
    - Two keys, same hash tag required in Cluster: callers build them as
      lockout:{ip:emailHash} and lockout:lock:{ip:emailHash} so the braces
      pin both to one slot.
    - Idempotent per call: one invocation = one recorded failure.
--]]

local counter_key = KEYS[1]
local lock_key    = KEYS[2]
local now_ms      = tonumber(ARGV[1])
local ttl_ms      = tonumber(ARGV[2])

if not now_ms or not ttl_ms then
  return redis.error_reply('eventini: now_ms and counter_ttl_ms must be numbers')
end

-- Already locked? Report and do not extend: an attacker must not be able to
-- keep a lock alive indefinitely by hammering it.
local existing_until = redis.call('GET', lock_key)
if existing_until then
  local attempts = tonumber(redis.call('GET', counter_key) or '0')
  return { 1, tonumber(existing_until), attempts }
end

local function split_numbers(csv)
  local out = {}
  for token in string.gmatch(csv, '([^,]+)') do
    out[#out + 1] = tonumber(token)
  end
  return out
end

local thresholds = split_numbers(ARGV[3])
local durations  = split_numbers(ARGV[4])

if #thresholds == 0 or #thresholds ~= #durations then
  return redis.error_reply('eventini: thresholds and durations must be non-empty and equal length')
end

local attempts = redis.call('INCR', counter_key)
redis.call('PEXPIRE', counter_key, ttl_ms)

-- Walk the ladder from the top so the highest satisfied tier wins.
local matched_duration = nil
for i = #thresholds, 1, -1 do
  if attempts >= thresholds[i] then
    matched_duration = durations[i]
    break
  end
end

if not matched_duration then
  return { 0, 0, attempts }
end

local locked_until = now_ms + matched_duration
redis.call('SET', lock_key, locked_until, 'PX', matched_duration)

return { 1, locked_until, attempts }
`,

  ANTI_REPLAY_CLAIM: `--[[
  eventini:anti-replay-claim  v1
  ---------------------------------------------------------------------------
  Claims a single-use nonce. Used to stop a QR payload from being presented
  twice within its replay window (90 s, ADR-0009).

  This is the FIRST of three layers against a shared QR code:
    1. this nonce            blocks simultaneous presentation
    2. ux_attendance_checkin_unique  blocks the logical duplicate
    3. burst detection       flags a compromised device

  SET NX PX alone would be enough for the claim itself. The script exists so
  that the claim and the "who claimed it" bookkeeping happen together: on a
  replay the caller needs the original claimant to produce a useful refusal
  reason instead of a bare 409.

  KEYS[1]  nonce key             replay:{scope}:{nonce}
  ARGV[1]  ttl_ms                replay window
  ARGV[2]  claimant              opaque id recorded on first claim
  ARGV[3]  now_ms

  RETURN   { claimed, original_claimant, claimed_at_ms }
             claimed  1 = first claim (proceed), 0 = replay (refuse)
             original_claimant  '' on first claim, the stored value on replay
             claimed_at_ms  0 on first claim, original timestamp on replay
--]]

local key      = KEYS[1]
local ttl_ms   = tonumber(ARGV[1])
local claimant = ARGV[2]
local now_ms   = tonumber(ARGV[3])

if not ttl_ms or ttl_ms <= 0 then
  return redis.error_reply('eventini: ttl_ms must be a positive number')
end
if not now_ms then
  return redis.error_reply('eventini: now_ms must be a number')
end
if claimant == nil or claimant == '' then
  return redis.error_reply('eventini: claimant must not be empty')
end

local payload = claimant .. '|' .. tostring(now_ms)
local ok = redis.call('SET', key, payload, 'NX', 'PX', ttl_ms)

if ok then
  return { 1, '', 0 }
end

-- Replay. Return who got there first so the refusal can be explained.
local existing = redis.call('GET', key)
if not existing then
  -- Expired between SET NX and GET. Treat as a replay: failing closed is the
  -- correct choice for an anti-replay control.
  return { 0, '', 0 }
end

local sep = string.find(existing, '|', 1, true)
if not sep then
  return { 0, existing, 0 }
end

local original_claimant = string.sub(existing, 1, sep - 1)
local claimed_at        = tonumber(string.sub(existing, sep + 1)) or 0

return { 0, original_claimant, claimed_at }
`,

  DISTRIBUTED_LOCK: `--[[
  eventini:distributed-lock  v1
  ---------------------------------------------------------------------------
  Fenced acquire / release / extend for a short-lived advisory lock.

  Why Lua: releasing a lock is the classic bug. A naive DEL releases whatever
  is there, including a lock a DIFFERENT instance acquired after ours expired.
  The owner token must be compared and deleted in one atomic step.

  This lock is ADVISORY ONLY. It never replaces a PostgreSQL constraint.
  Refresh-token rotation is serialised by ux_refresh_active_per_family and
  idempotency by ux_idempotency_scope (ADR-0012, ADR-0014) -- not by this lock.
  Use it for coordination (one worker per import batch), never for correctness.

  KEYS[1]  lock key              lock:{scope}:{resource}
  ARGV[1]  operation             'acquire' | 'release' | 'extend'
  ARGV[2]  owner_token           unique per acquisition attempt
  ARGV[3]  ttl_ms                required for acquire and extend

  RETURN
    acquire  { 1, ttl_ms }            acquired
             { 0, remaining_ms }      held by someone else
    release  { 1, 0 }                 released by owner
             { 0, 0 }                 not owner, or already gone -- no-op
    extend   { 1, ttl_ms }            extended by owner
             { 0, 0 }                 not owner
--]]

local key       = KEYS[1]
local operation = ARGV[1]
local owner     = ARGV[2]

if owner == nil or owner == '' then
  return redis.error_reply('eventini: owner_token must not be empty')
end

if operation == 'acquire' then
  local ttl_ms = tonumber(ARGV[3])
  if not ttl_ms or ttl_ms <= 0 then
    return redis.error_reply('eventini: ttl_ms must be a positive number')
  end

  local ok = redis.call('SET', key, owner, 'NX', 'PX', ttl_ms)
  if ok then
    return { 1, ttl_ms }
  end

  -- Re-entrant: the same owner re-acquiring refreshes its own lock rather
  -- than deadlocking against itself.
  if redis.call('GET', key) == owner then
    redis.call('PEXPIRE', key, ttl_ms)
    return { 1, ttl_ms }
  end

  local remaining = redis.call('PTTL', key)
  if remaining < 0 then remaining = 0 end
  return { 0, remaining }
end

if operation == 'release' then
  if redis.call('GET', key) == owner then
    redis.call('DEL', key)
    return { 1, 0 }
  end
  return { 0, 0 }
end

if operation == 'extend' then
  local ttl_ms = tonumber(ARGV[3])
  if not ttl_ms or ttl_ms <= 0 then
    return redis.error_reply('eventini: ttl_ms must be a positive number')
  end
  if redis.call('GET', key) == owner then
    redis.call('PEXPIRE', key, ttl_ms)
    return { 1, ttl_ms }
  end
  return { 0, 0 }
end

return redis.error_reply("eventini: operation must be 'acquire', 'release' or 'extend'")
`,
} as const;

export type LuaScriptName = keyof typeof LUA_SCRIPTS;

/** The repository file each embedded source mirrors, for the drift check. */
export const LUA_SCRIPT_FILES: Record<LuaScriptName, string> = {
  RATE_LIMIT_SLIDING_WINDOW: 'rate-limit-sliding-window.lua',
  LOCKOUT_REGISTER_FAILURE: 'lockout-register-failure.lua',
  ANTI_REPLAY_CLAIM: 'anti-replay-claim.lua',
  DISTRIBUTED_LOCK: 'distributed-lock.lua',
};
