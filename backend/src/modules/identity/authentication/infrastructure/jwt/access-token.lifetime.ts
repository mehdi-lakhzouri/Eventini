import type { SessionClientType } from '../../../../../infrastructure/database/enums';

export interface AccessTokenLifetimes {
  readonly webAdmin: number;
  readonly webSuperAdmin: number;
  readonly scanner: number;
}

/**
 * ADR-0009's matrix. A scanner has to survive a venue with poor connectivity;
 * a platform administrator's browser gets the shortest window in the system,
 * because that token is the most valuable one to steal.
 */
export function accessTokenTtlSeconds(
  clientType: SessionClientType,
  isPlatformAdmin: boolean,
  lifetimes: AccessTokenLifetimes,
): number {
  if (clientType === 'MOBILE_SCANNER') {
    return lifetimes.scanner;
  }

  return isPlatformAdmin ? lifetimes.webSuperAdmin : lifetimes.webAdmin;
}
