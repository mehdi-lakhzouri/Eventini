--[[
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
