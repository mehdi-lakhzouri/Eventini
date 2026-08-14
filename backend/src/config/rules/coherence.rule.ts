import type { Env } from '../env.schema';
import type { EnvironmentRule } from './rule.types';
import { formatDuration } from '../parsers/duration.parser';

const SESSION_PROFILES = [
  {
    label: 'WEB / CLIENT_ADMIN',
    idle: 'SESSION_IDLE_TTL_WEB_ADMIN',
    absolute: 'SESSION_ABSOLUTE_TTL_WEB_ADMIN',
  },
  {
    label: 'WEB / SUPER_ADMIN',
    idle: 'SESSION_IDLE_TTL_WEB_SUPER_ADMIN',
    absolute: 'SESSION_ABSOLUTE_TTL_WEB_SUPER_ADMIN',
  },
  {
    label: 'MOBILE_SCANNER',
    idle: 'SESSION_IDLE_TTL_SCANNER',
    absolute: 'SESSION_ABSOLUTE_TTL_SCANNER',
  },
] as const satisfies readonly {
  label: string;
  idle: keyof Env;
  absolute: keyof Env;
}[];

/** OWASP Password Storage minimum for Argon2id, in KiB (ADR-0007). */
const OWASP_MINIMUM_ARGON2_MEMORY_COST = 19_456;

/**
 * Rules 6 and 11 to 14 — values that are individually valid but contradict each
 * other.
 */
export const coherenceRule: EnvironmentRule = {
  id: '6,11-14',
  description: 'Related values do not contradict each other',

  check(env) {
    const errors: string[] = [];

    // Rule 6 — `trust proxy` as a boolean makes Express accept any
    // X-Forwarded-For the client sends, so every IP-based rate limit and the
    // whole lockout ladder can be bypassed by forging one header. The schema
    // already forces an integer; this states the reason the type is not a
    // boolean in the first place.
    if (
      !Number.isInteger(env.TRUSTED_PROXY_HOPS) ||
      env.TRUSTED_PROXY_HOPS < 0
    ) {
      errors.push(
        'TRUSTED_PROXY_HOPS must be an integer >= 0 (a hop count, never true). With a boolean, anyone can forge X-Forwarded-For and bypass every IP-based rate limit.',
      );
    }

    // Rule 11 — a default above the maximum means the very first page request
    // is rejected by the clamp meant to protect against oversized pages.
    if (env.PAGINATION_DEFAULT_LIMIT > env.PAGINATION_MAX_LIMIT) {
      errors.push(
        `PAGINATION_DEFAULT_LIMIT (${env.PAGINATION_DEFAULT_LIMIT}) must be <= PAGINATION_MAX_LIMIT (${env.PAGINATION_MAX_LIMIT}).`,
      );
    }

    // Rule 12 — idle beyond absolute makes the idle timeout unreachable: the
    // absolute deadline always fires first, so the shorter control silently
    // never applies.
    for (const profile of SESSION_PROFILES) {
      const idle = env[profile.idle];
      const absolute = env[profile.absolute];

      if (
        typeof idle === 'number' &&
        typeof absolute === 'number' &&
        idle > absolute
      ) {
        errors.push(
          `${profile.idle} (${formatDuration(idle)}) must be <= ${profile.absolute} (${formatDuration(absolute)}) for ${profile.label}; otherwise the idle timeout can never fire.`,
        );
      }
    }

    // Rule 13 — mismatched lengths mean a threshold with no duration, so a
    // lockout tier either never triggers or triggers with an undefined length.
    if (env.LOCKOUT_THRESHOLDS.length !== env.LOCKOUT_DURATIONS.length) {
      errors.push(
        `LOCKOUT_THRESHOLDS has ${env.LOCKOUT_THRESHOLDS.length} entries but LOCKOUT_DURATIONS has ${env.LOCKOUT_DURATIONS.length}; each threshold needs exactly one duration.`,
      );
    }

    // A ladder that does not increase is not a ladder.
    const thresholds = env.LOCKOUT_THRESHOLDS;
    for (let index = 1; index < thresholds.length; index += 1) {
      const previous = thresholds[index - 1];
      const current = thresholds[index];

      if (
        previous !== undefined &&
        current !== undefined &&
        current <= previous
      ) {
        errors.push(
          `LOCKOUT_THRESHOLDS must increase strictly; ${current} follows ${previous}.`,
        );
        break;
      }
    }

    // Rule 14 — below this, the hash leaves the OWASP recommendation and the
    // stored passwords become materially cheaper to crack offline.
    if (env.ARGON2_MEMORY_COST < OWASP_MINIMUM_ARGON2_MEMORY_COST) {
      errors.push(
        `ARGON2_MEMORY_COST (${env.ARGON2_MEMORY_COST}) must be >= ${OWASP_MINIMUM_ARGON2_MEMORY_COST} KiB (ADR-0007); below it the hash leaves the OWASP recommendation.`,
      );
    }

    // Not numbered, but the same family: a maximum below the minimum makes
    // every password simultaneously too short and too long.
    if (env.PASSWORD_MIN_LENGTH > env.PASSWORD_MAX_LENGTH) {
      errors.push(
        `PASSWORD_MIN_LENGTH (${env.PASSWORD_MIN_LENGTH}) must be <= PASSWORD_MAX_LENGTH (${env.PASSWORD_MAX_LENGTH}).`,
      );
    }

    if (env.SEARCH_MIN_LENGTH > env.SEARCH_MAX_LENGTH) {
      errors.push(
        `SEARCH_MIN_LENGTH (${env.SEARCH_MIN_LENGTH}) must be <= SEARCH_MAX_LENGTH (${env.SEARCH_MAX_LENGTH}).`,
      );
    }

    // An access token outliving its refresh token means the refresh flow can
    // never run before the session is already unusable.
    const accessRefreshPairs = [
      ['ACCESS_TOKEN_TTL_WEB_ADMIN', 'REFRESH_TOKEN_TTL_WEB_ADMIN'],
      ['ACCESS_TOKEN_TTL_WEB_SUPER_ADMIN', 'REFRESH_TOKEN_TTL_WEB_SUPER_ADMIN'],
      ['ACCESS_TOKEN_TTL_SCANNER', 'REFRESH_TOKEN_TTL_SCANNER'],
    ] as const satisfies readonly (readonly [keyof Env, keyof Env])[];

    for (const [accessVar, refreshVar] of accessRefreshPairs) {
      const access = env[accessVar];
      const refresh = env[refreshVar];

      if (
        typeof access === 'number' &&
        typeof refresh === 'number' &&
        access >= refresh
      ) {
        errors.push(
          `${accessVar} (${formatDuration(access)}) must be shorter than ${refreshVar} (${formatDuration(refresh)}); otherwise rotation can never happen before the session expires.`,
        );
      }
    }

    return errors;
  },
};
