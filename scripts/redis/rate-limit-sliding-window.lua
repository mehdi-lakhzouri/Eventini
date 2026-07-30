--[[
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
