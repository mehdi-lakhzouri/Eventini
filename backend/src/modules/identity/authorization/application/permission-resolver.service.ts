import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { redisKeys } from '../../../../infrastructure/redis/redis-key.builder';
import {
  ORGANIZATION_PERMISSIONS_TTL_MS,
  PLATFORM_PERMISSIONS_TTL_MS,
  PermissionCache,
} from '../domain/permission-cache';
import { PermissionRepository } from '../domain/permission.repository';
import { PermissionsVersionStore } from '../domain/permissions-version.store';

/**
 * The effective permission set for a caller — ADR-0004, step 6 of the chain.
 *
 * ## Nothing here reads the access token
 *
 * The token carries no permissions and never will. Everything is resolved
 * server-side per request, which is what makes a revocation take effect the
 * moment it commits rather than whenever the token happens to expire. That
 * property is the entire reason for the round trip, and no cache may weaken
 * it: the version in the key is bumped inside the revoking transaction, so the
 * old entry is unreachable rather than merely stale.
 *
 * ## Redis is an optimisation, never an authority
 *
 * Every path falls back to PostgreSQL. A cache miss, a Redis outage and a
 * poisoned entry all end in the same place — the tables. There is no branch
 * anywhere below that returns "allow" because a lookup failed.
 */
@Injectable()
export class PermissionResolver {
  constructor(
    private readonly repository: PermissionRepository,
    private readonly cache: PermissionCache,
    private readonly versions: PermissionsVersionStore,
    private readonly logger: PinoLogger,
  ) {}

  async forMembership(membershipId: string): Promise<string[]> {
    return this.cached({
      version: () => this.versions.forMembership(membershipId),
      key: (version) =>
        redisKeys.cache.membershipPermissions(membershipId, version),
      ttlMs: ORGANIZATION_PERMISSIONS_TTL_MS,
      load: () => this.repository.organizationPermissions(membershipId),
      subject: membershipId,
    });
  }

  async forPlatform(userId: string): Promise<string[]> {
    return this.cached({
      version: () => this.versions.forPlatform(userId),
      key: (version) => redisKeys.cache.platformPermissions(userId, version),
      ttlMs: PLATFORM_PERMISSIONS_TTL_MS,
      load: () => this.repository.platformPermissions(userId),
      subject: userId,
    });
  }

  /**
   * Event grants are **not** cached.
   *
   * The set depends on the event *and* on the clock — `valid_from` and
   * `valid_until` bound it — so a cached copy would outlive the window it was
   * computed in and keep granting access after a grant expired. The cache key
   * would also have to carry the event id, multiplying entries by every event
   * a user touches for a set that is cheap to read and rarely reused.
   */
  async forEvent(membershipId: string, eventId: string): Promise<string[]> {
    return this.repository.eventPermissions(membershipId, eventId, new Date());
  }

  private async cached(spec: {
    version: () => Promise<number>;
    key: (version: number) => string;
    ttlMs: number;
    load: () => Promise<string[]>;
    subject: string;
  }): Promise<string[]> {
    let key: string | null = null;

    try {
      key = spec.key(await spec.version());
      const hit = await this.cache.read(key);

      if (hit !== null) {
        return hit;
      }
    } catch (error: unknown) {
      // The version lookup or the read failed, so there is no key to write
      // back under either. Fall through to PostgreSQL and skip the write.
      this.reportFallback(error, spec.subject);
      key = null;
    }

    const permissions = await spec.load();

    if (key !== null) {
      await this.cache
        .write(key, permissions, spec.ttlMs)
        .catch((error: unknown) => {
          // A failed write costs a round trip next time and nothing else. The
          // answer already came from the source of truth.
          this.reportFallback(error, spec.subject);
        });
    }

    return permissions;
  }

  private reportFallback(error: unknown, subject: string): void {
    this.logger.warn(
      {
        err: error,
        category: 'SECURITY',
        eventCode: 'SESSION_CACHE_MISS',
        subject,
      },
      'Permission cache unavailable, resolving from PostgreSQL',
    );
  }
}
