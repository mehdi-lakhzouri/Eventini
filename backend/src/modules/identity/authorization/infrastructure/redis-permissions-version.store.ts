import { Inject, Injectable } from '@nestjs/common';

import { redisKeys } from '../../../../infrastructure/redis/redis-key.builder';
import type { RedisConnection } from '../../../../infrastructure/redis/redis-connection.factory';
import { REDIS_APP } from '../../../../infrastructure/redis/redis.tokens';
import { PermissionsVersionStore } from '../domain/permissions-version.store';

/**
 * The version counters, in Redis and **without a TTL**.
 *
 * ## Why no expiry, stated where someone might add one
 *
 * These counters sit beside the cache entries they invalidate. If a counter
 * expired while entries survived, the version would count back down and stale
 * entries — including permissions that had been revoked — would become
 * reachable again. Losing the counter and the entries together is harmless,
 * because there is then nothing left to resurrect. So: entries carry a TTL,
 * counters never do.
 *
 * ## The mirror column ADR-0004 also asks for
 *
 * The ADR describes "a Redis counter plus a mirror column". The column is not
 * in the schema and sprint 06 declares no migrations, so it is deliberately
 * not invented here. It is not needed for correctness: the counter and the
 * cache share one Redis, so they are lost together, and a counter restarting
 * from zero cannot expose entries that vanished with it. What the column would
 * add is durability across a full Redis loss for audit purposes — recorded as
 * a limitation rather than quietly skipped.
 */
@Injectable()
export class RedisPermissionsVersionStore extends PermissionsVersionStore {
  constructor(@Inject(REDIS_APP) private readonly redis: RedisConnection) {
    super();
  }

  async forMembership(membershipId: string): Promise<number> {
    return this.read(redisKeys.cache.permissionsVersion(membershipId));
  }

  async forPlatform(userId: string): Promise<number> {
    return this.read(redisKeys.cache.permissionsVersion(`platform:${userId}`));
  }

  async bumpMembership(membershipId: string): Promise<number> {
    return this.redis.incr(redisKeys.cache.permissionsVersion(membershipId));
  }

  async bumpPlatform(userId: string): Promise<number> {
    return this.redis.incr(
      redisKeys.cache.permissionsVersion(`platform:${userId}`),
    );
  }

  /** A counter that has never been bumped reads as version 0. */
  private async read(key: string): Promise<number> {
    const raw = await this.redis.get(key);

    if (raw === null) {
      return 0;
    }

    const parsed = Number.parseInt(raw, 10);

    return Number.isNaN(parsed) ? 0 : parsed;
  }
}
