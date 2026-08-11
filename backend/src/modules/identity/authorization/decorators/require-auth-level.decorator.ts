import { SetMetadata } from '@nestjs/common';

import type { AuthLevel } from '../../../../common/types/tenant-context';

export const REQUIRED_AUTH_LEVEL = 'eventini:auth-level';

/**
 * How much proof a session carries, in increasing order.
 *
 * Ordered rather than compared for equality: a `REAUTHENTICATED` session
 * satisfies a route asking for `MFA`, because it proved more, not less. An
 * equality check would refuse the caller who just re-entered their password to
 * get in — the most confusing possible outcome of a security control.
 */
const RANK: Record<AuthLevel, number> = {
  PASSWORD: 0,
  MFA: 1,
  REAUTHENTICATED: 2,
};

export function satisfiesAuthLevel(
  actual: AuthLevel,
  required: AuthLevel,
): boolean {
  return RANK[actual] >= RANK[required];
}

/**
 * Demands a stronger session than a password alone — §6.5's sensitive
 * operations: disabling MFA, rotating a signing key, impersonation, deleting
 * an account.
 */
export const RequireAuthLevel = (level: AuthLevel) =>
  SetMetadata(REQUIRED_AUTH_LEVEL, level);
