/** A cached permission set, or a miss. */
export abstract class PermissionCache {
  abstract read(key: string): Promise<string[] | null>;

  abstract write(
    key: string,
    permissions: readonly string[],
    ttlMs: number,
  ): Promise<void>;
}

/**
 * ADR-0004's TTLs. Platform is deliberately the shorter of the two: the
 * privileges are higher, so the window in which a stale entry could still be
 * honoured after a Redis-side mishap should be smaller.
 *
 * These are a ceiling on staleness, not the invalidation mechanism — a version
 * bump is instant and does not wait for them.
 */
export const ORGANIZATION_PERMISSIONS_TTL_MS = 300_000;
export const PLATFORM_PERMISSIONS_TTL_MS = 60_000;
