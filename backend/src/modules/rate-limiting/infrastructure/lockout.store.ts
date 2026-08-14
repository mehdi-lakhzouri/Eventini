import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { rateLimitConfig } from '../../../config/rate-limit.config';
import { redisKeys } from '../../../infrastructure/redis/redis-key.builder';
import { RedisScriptRegistry } from '../../../infrastructure/redis/redis-script.registry';
import type { RedisConnection } from '../../../infrastructure/redis/redis-connection.factory';
import { REDIS_APP } from '../../../infrastructure/redis/redis.tokens';

export interface LockoutState {
  readonly locked: boolean;
  readonly attempts: number;
}

/** How long consecutive failures accumulate before the count decays. */
const COUNTER_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The progressive lockout ladder, keyed on **ip+email** and never on email.
 *
 * §5.2 is the load-bearing decision of this whole document. Locking on the
 * address alone lets anyone lock out any user whose email they know by failing
 * five times: the control becomes a free, remote, deniable denial of service
 * against the victim. With ip+email an attacker locks out only their own pair.
 *
 * A per-email counter exists alongside it and **never locks**. It raises a
 * detection signal so the attack is visible, which is the compromise that lets
 * the victim keep their access while the operator still sees what is going on.
 */
@Injectable()
export class LockoutStore {
  constructor(
    private readonly scripts: RedisScriptRegistry,
    @Inject(REDIS_APP) private readonly redis: RedisConnection,
    @Inject(rateLimitConfig.KEY)
    private readonly settings: ConfigType<typeof rateLimitConfig>,
  ) {}

  /** True when this pair is currently serving a lockout. */
  async isLocked(ip: string | null, email: string): Promise<boolean> {
    const value = await this.redis.get(redisKeys.lockout.lock(ip, email));

    return value !== null;
  }

  /**
   * Records one failure and applies the ladder atomically. Returns the state
   * *after* this failure.
   */
  async registerFailure(
    ip: string | null,
    email: string,
  ): Promise<LockoutState> {
    const reply = await this.scripts.run(
      'LOCKOUT_REGISTER_FAILURE',
      [redisKeys.lockout.counter(ip, email), redisKeys.lockout.lock(ip, email)],
      [
        String(Date.now()),
        String(COUNTER_TTL_MS),
        this.settings.lockout.thresholds.join(','),
        this.settings.lockout.durations.join(','),
      ],
    );

    const [locked, , attempts] = reply.map(Number);

    return { locked: locked === 1, attempts: attempts ?? 0 };
  }

  /**
   * The detection counter: per email, across every IP, and it blocks nothing.
   * Returns the running count so the caller can decide whether to raise a
   * security event.
   */
  async countEmailFailure(email: string): Promise<number> {
    const key = redisKeys.lockout.emailCounter(email);
    const count = await this.redis.incr(key);

    if (count === 1) {
      await this.redis.pExpire(key, 60 * 60 * 1000);
    }

    return count;
  }

  /** A successful authentication clears the ladder for that pair. */
  async clear(ip: string | null, email: string): Promise<void> {
    await this.redis.del([
      redisKeys.lockout.counter(ip, email),
      redisKeys.lockout.lock(ip, email),
    ]);
  }
}
