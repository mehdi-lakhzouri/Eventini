import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { RedisModule } from '../../infrastructure/redis';
import { LockoutStore } from './infrastructure/lockout.store';
import { SlidingWindowLimiter } from './infrastructure/sliding-window.limiter';
import { RateLimitGuard } from './rate-limit.guard';

/**
 * Imported by `AppModule` **before** `IdentityModule`, which is what puts
 * `RateLimitGuard` ahead of `CsrfGuard` in the global guard chain: Nest runs
 * `APP_GUARD` providers in registration order, and §7.5 requires rate limiting
 * to come first. `rate-limit-ordering.e2e-spec.ts` asserts the resulting
 * behaviour rather than trusting the import order to stay put.
 */
@Module({
  imports: [RedisModule],
  providers: [
    SlidingWindowLimiter,
    LockoutStore,
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [SlidingWindowLimiter, LockoutStore],
})
export class RateLimitingModule {}
