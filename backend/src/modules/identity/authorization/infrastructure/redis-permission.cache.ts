import { Inject, Injectable } from '@nestjs/common';

import type { RedisConnection } from '../../../../infrastructure/redis/redis-connection.factory';
import { REDIS_APP } from '../../../../infrastructure/redis/redis.tokens';
import { PermissionCache } from '../domain/permission-cache';

/**
 * The permission set as a JSON array under a versioned key.
 *
 * Errors are not swallowed here. The resolver catches them and falls through
 * to PostgreSQL, which is the layer that knows a failed lookup must never
 * become an authorisation — burying the failure at this level would make that
 * decision invisible.
 */
@Injectable()
export class RedisPermissionCache extends PermissionCache {
  constructor(@Inject(REDIS_APP) private readonly redis: RedisConnection) {
    super();
  }

  async read(key: string): Promise<string[] | null> {
    const raw = await this.redis.get(key);

    if (raw === null) {
      return null;
    }

    // A value that is not the array we wrote is treated as a miss rather than
    // trusted or thrown on: the caller then reads PostgreSQL, which is correct
    // whatever put the wrong shape there.
    return parsePermissions(raw);
  }

  async write(
    key: string,
    permissions: readonly string[],
    ttlMs: number,
  ): Promise<void> {
    await this.redis.set(key, JSON.stringify(permissions), { PX: ttlMs });
  }
}

function parsePermissions(raw: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);

    return Array.isArray(parsed) &&
      parsed.every((entry) => typeof entry === 'string')
      ? parsed
      : null;
  } catch {
    return null;
  }
}
