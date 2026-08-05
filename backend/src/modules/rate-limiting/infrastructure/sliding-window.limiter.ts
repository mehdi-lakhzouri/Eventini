import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { RedisScriptRegistry } from '../../../infrastructure/redis/redis-script.registry';
import type { RateLimitDecision } from '../domain/rate-limit.decision';
import type { RateLimitRule } from '../domain/rate-limit.policy';

/**
 * One rule, one round trip, no race — the sliding-window Lua of ADR-0011.
 *
 * The window is sliding rather than fixed because a fixed window lets through
 * twice the ceiling across a boundary: five attempts at 14m59s and five more
 * at 15m01s is ten in two seconds against a "5 per 15 minutes" login limit.
 */
@Injectable()
export class SlidingWindowLimiter {
  constructor(private readonly scripts: RedisScriptRegistry) {}

  async check(rule: RateLimitRule): Promise<RateLimitDecision> {
    const reply = await this.scripts.run(
      'RATE_LIMIT_SLIDING_WINDOW',
      [rule.key],
      [
        String(rule.limit),
        String(rule.windowMs),
        String(Date.now()),
        // A unique member per request: the sorted set counts entries, so two
        // requests sharing a member id would be one entry and the second would
        // be free.
        randomUUID(),
      ],
    );

    const [allowed, remaining, retryAfter] = reply.map(Number);

    return {
      allowed: allowed === 1,
      limit: rule.limit,
      remaining: Math.max(0, remaining ?? 0),
      retryAfterSeconds: Math.max(0, retryAfter ?? 0),
    };
  }
}
