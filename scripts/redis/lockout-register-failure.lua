--[[
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
