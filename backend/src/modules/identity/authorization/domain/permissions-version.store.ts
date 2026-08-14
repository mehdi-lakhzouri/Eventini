/**
 * The counter that makes a revocation take effect immediately.
 *
 * ## Invalidation by increment, never by deletion
 *
 * Bumping the version makes every key of the old version unreachable at once,
 * with no key to find and no scan to run. Deleting by pattern would need
 * `SCAN`, would be partial under load, and a missed key means a **revoked
 * permission still being granted** — the one failure this whole mechanism
 * exists to prevent.
 *
 * ## Why the counter must never expire
 *
 * The counter and the cache entries live in the same Redis. If the counter
 * expired while entries survived, the version would count back down and stale
 * entries would become reachable again. Losing both together is harmless —
 * there is nothing left to resurrect — so the rule is simply that the counter
 * carries no TTL while every cached set does.
 */
export abstract class PermissionsVersionStore {
  /** Current version for a membership. A counter that has never been bumped reads as 0. */
  abstract forMembership(membershipId: string): Promise<number>;

  abstract forPlatform(userId: string): Promise<number>;

  /**
   * Called inside the transaction that changes a role, a membership or an
   * organization's status. Outside it, a reader can observe the new rows under
   * the old version and cache them — permissions that are stale until the TTL.
   */
  abstract bumpMembership(membershipId: string): Promise<number>;

  abstract bumpPlatform(userId: string): Promise<number>;
}
