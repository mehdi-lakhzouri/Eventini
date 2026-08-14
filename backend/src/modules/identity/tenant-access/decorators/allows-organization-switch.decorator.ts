import { SetMetadata } from '@nestjs/common';

export const ALLOWS_ORGANIZATION_SWITCH = 'eventini:organization-switch';

/**
 * Permits a route to name an organization other than the session's.
 *
 * Exactly one route legitimately does: `POST /organizations/{id}/activation`,
 * whose entire purpose is to move to an organization the session is **not**
 * currently scoped to. Comparing the path against the session there would make
 * switching impossible.
 *
 * It is a decorator rather than a path exception inside the guard so that it
 * appears on the route it applies to, where a reviewer reading that route sees
 * it. A list of exempt paths hidden in a guard is a list nobody rereads.
 *
 * This does **not** loosen anything else. The route still resolves the target
 * against the caller's own memberships, so a forged id finds nothing — see
 * `PrismaOrganizationRepository.findActivationTarget`.
 */
export const AllowsOrganizationSwitch = () =>
  SetMetadata(ALLOWS_ORGANIZATION_SWITCH, true);
