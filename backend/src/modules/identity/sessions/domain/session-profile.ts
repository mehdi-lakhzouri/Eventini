import type { SessionClientType } from '../../../../infrastructure/database/enums';

/** ADR-0009 differentiates every lifetime by client type and privilege. */
export type SessionProfile = 'webAdmin' | 'webSuperAdmin' | 'scanner';

export type ProfileLifetimes = Readonly<Record<SessionProfile, number>>;

export function profileFor(
  clientType: SessionClientType,
  isPlatformAdmin: boolean,
): SessionProfile {
  if (clientType === 'MOBILE_SCANNER') {
    return 'scanner';
  }

  return isPlatformAdmin ? 'webSuperAdmin' : 'webAdmin';
}

export interface SessionDeadlines {
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly refreshExpiresAt: Date;
}

export interface LifetimeSettings {
  readonly sessionIdle: ProfileLifetimes;
  readonly sessionAbsolute: ProfileLifetimes;
  readonly refreshToken: ProfileLifetimes;
}

/**
 * `absoluteExpiresAt` is fixed here and never recomputed. A rotation pushes
 * the idle deadline forward; extending the absolute one would turn a bounded
 * session into a perpetual one, which is the whole point of having two.
 */
export function deadlinesFor(
  profile: SessionProfile,
  lifetimes: LifetimeSettings,
  now: Date,
): SessionDeadlines {
  const at = (seconds: number): Date =>
    new Date(now.getTime() + seconds * 1000);

  return {
    idleExpiresAt: at(lifetimes.sessionIdle[profile]),
    absoluteExpiresAt: at(lifetimes.sessionAbsolute[profile]),
    refreshExpiresAt: at(lifetimes.refreshToken[profile]),
  };
}
