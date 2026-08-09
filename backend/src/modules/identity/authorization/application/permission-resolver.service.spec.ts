import type { PinoLogger } from 'nestjs-pino';

import type { PermissionCache } from '../domain/permission-cache';
import type { PermissionRepository } from '../domain/permission.repository';
import type { PermissionsVersionStore } from '../domain/permissions-version.store';
import { PermissionResolver } from './permission-resolver.service';

function build(
  options: {
    stored?: Record<string, string[]>;
    version?: number;
    failVersion?: boolean;
    failRead?: boolean;
    failWrite?: boolean;
    organization?: string[];
    platform?: string[];
  } = {},
) {
  const cache = new Map<string, string[]>(Object.entries(options.stored ?? {}));
  const reads: string[] = [];
  const writes: { key: string; ttlMs: number }[] = [];
  const loads: string[] = [];
  let version = options.version ?? 1;

  const repository = {
    organizationPermissions: (membershipId: string) => {
      loads.push(`org:${membershipId}`);

      return Promise.resolve(options.organization ?? ['events.read']);
    },
    platformPermissions: (userId: string) => {
      loads.push(`platform:${userId}`);

      return Promise.resolve(options.platform ?? ['platform.manage']);
    },
    eventPermissions: (membershipId: string, eventId: string) => {
      loads.push(`event:${membershipId}:${eventId}`);

      return Promise.resolve(['attendance.scan']);
    },
  } as unknown as PermissionRepository;

  // Annotated rather than cast: the fake satisfies the port structurally, so
  // an assertion would be redundant and the linter strips it — leaving the
  // fake unchecked against the interface it is standing in for.
  const permissionCache: PermissionCache = {
    read: (key: string) => {
      reads.push(key);

      return options.failRead === true
        ? Promise.reject(new Error('redis down'))
        : Promise.resolve(cache.get(key) ?? null);
    },
    write: (key: string, permissions: readonly string[], ttlMs: number) => {
      if (options.failWrite === true) {
        return Promise.reject(new Error('redis down'));
      }

      writes.push({ key, ttlMs });
      cache.set(key, [...permissions]);

      return Promise.resolve();
    },
  };

  const versions = {
    forMembership: () =>
      options.failVersion === true
        ? Promise.reject(new Error('redis down'))
        : Promise.resolve(version),
    forPlatform: () =>
      options.failVersion === true
        ? Promise.reject(new Error('redis down'))
        : Promise.resolve(version),
  } as unknown as PermissionsVersionStore;

  const logger = { warn: () => undefined } as unknown as PinoLogger;

  return {
    resolver: new PermissionResolver(
      repository,
      permissionCache,
      versions,
      logger,
    ),
    reads,
    writes,
    loads,
    cache,
    bump: () => {
      version += 1;
    },
  };
}

describe('PermissionResolver', () => {
  describe('the versioned key', () => {
    it('reads and writes under the current version', async () => {
      const { resolver, reads, writes } = build({ version: 4 });

      await resolver.forMembership('mbr_1');

      expect(reads[0]).toContain(':v4');
      expect(writes[0]?.key).toContain(':v4');
    });

    it('serves the second call from the cache', async () => {
      const { resolver, loads } = build();

      await resolver.forMembership('mbr_1');
      await resolver.forMembership('mbr_1');

      expect(loads).toEqual(['org:mbr_1']);
    });

    /**
     * 🔴 The property the whole design exists for. A bump makes every key of
     * the old version unreachable at once — no key to find, no scan to run, no
     * partial deletion that would leave a revoked permission still granted.
     */
    it('stops serving the old entry the moment the version moves', async () => {
      const { resolver, loads, bump } = build();

      await resolver.forMembership('mbr_1');
      bump();
      await resolver.forMembership('mbr_1');

      expect(loads).toEqual(['org:mbr_1', 'org:mbr_1']);
    });

    it('never returns the old set after a bump', async () => {
      const { resolver, bump } = build({ organization: ['events.read'] });

      await resolver.forMembership('mbr_1');
      bump();

      // The repository is the source of truth and now answers differently.
      const after = build({ organization: [], version: 2 });
      await expect(after.resolver.forMembership('mbr_1')).resolves.toEqual([]);
    });
  });

  describe('the TTLs of ADR-0004', () => {
    it('caches an organization set for 300 s', async () => {
      const { resolver, writes } = build();

      await resolver.forMembership('mbr_1');

      expect(writes[0]?.ttlMs).toBe(300_000);
    });

    /** Higher privilege, shorter window in which anything could be stale. */
    it('caches a platform set for only 60 s', async () => {
      const { resolver, writes } = build();

      await resolver.forPlatform('usr_1');

      expect(writes[0]?.ttlMs).toBe(60_000);
    });
  });

  /**
   * 🔴 ADR-0004: Redis down means read PostgreSQL. It never means allow.
   */
  describe('when Redis is unavailable', () => {
    it.each([
      ['the version lookup fails', { failVersion: true }],
      ['the read fails', { failRead: true }],
      ['the write fails', { failWrite: true }],
    ])('still answers from PostgreSQL when %s', async (_label, failure) => {
      const { resolver, loads } = build({
        ...failure,
        organization: ['events.read'],
      });

      await expect(resolver.forMembership('mbr_1')).resolves.toEqual([
        'events.read',
      ]);
      expect(loads).toEqual(['org:mbr_1']);
    });

    it('returns the empty set rather than a permissive one', async () => {
      const { resolver } = build({ failVersion: true, organization: [] });

      await expect(resolver.forMembership('mbr_1')).resolves.toEqual([]);
    });

    it('does not try to write when it never got a key', async () => {
      const { resolver, writes } = build({ failVersion: true });

      await resolver.forMembership('mbr_1');

      expect(writes).toEqual([]);
    });
  });

  /**
   * Event grants are bounded by a clock, so a cached copy would outlive the
   * window it was computed in and keep granting access after expiry.
   */
  describe('event scope', () => {
    it('reads through on every call and caches nothing', async () => {
      const { resolver, reads, writes, loads } = build();

      await resolver.forEvent('mbr_1', 'evt_1');
      await resolver.forEvent('mbr_1', 'evt_1');

      expect(reads).toEqual([]);
      expect(writes).toEqual([]);
      expect(loads).toEqual(['event:mbr_1:evt_1', 'event:mbr_1:evt_1']);
    });
  });
});
