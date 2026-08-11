import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSION = 'eventini:permission';

/**
 * The scope a permission must be satisfied at — ADR-0004's routing table.
 *
 * `EVENT` is not a stronger `ORGANIZATION`. An organization permission does
 * **not** imply access to every event: a user can administer organization A,
 * analyse B, and be authorised on exactly one of B's events. Asking for an
 * `EVENT` permission means asking for an event assignment, and nothing else
 * will satisfy it.
 */
export type PermissionScope = 'ORGANIZATION' | 'PLATFORM' | 'EVENT';

export interface RequiredPermission {
  readonly code: string;
  readonly scope: PermissionScope;
  /**
   * Route parameter carrying the event id, for `EVENT` scope. Named rather
   * than positional so a route can call it `eventId` or `id` without the
   * decorator having to guess.
   */
  readonly eventParam?: string;
}

/**
 * Declares what step 6 must find in the caller's effective set.
 *
 * A route with no such declaration is still authenticated and still
 * tenant-checked — it simply requires no *specific* permission. That is the
 * right default for reading your own profile, and the wrong default for
 * anything else, which is why this is easy to add and impossible to imply.
 */
export const RequirePermission = (
  code: string,
  scope: PermissionScope = 'ORGANIZATION',
  eventParam?: string,
) =>
  SetMetadata(REQUIRED_PERMISSION, {
    code,
    scope,
    eventParam,
  } satisfies RequiredPermission);
