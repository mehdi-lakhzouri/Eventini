--[[
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
