/**
 * How long a readiness probe waits on a dependency before calling it down.
 *
 * Deliberately short. A readiness probe that hangs is worse than one that
 * fails: the orchestrator's own probe timeout fires instead, which it reports
 * as a timeout rather than as "PostgreSQL is unreachable", and the useful
 * information is lost exactly when it is needed. Two seconds is far above a
 * healthy round trip on the same network and far below any sane probe
 * timeout.
 */
export const DEPENDENCY_PROBE_TIMEOUT_MS = 2_000;

export const DATABASE_INDICATOR_KEY = 'database';
export const REDIS_INDICATOR_KEY = 'redis';
