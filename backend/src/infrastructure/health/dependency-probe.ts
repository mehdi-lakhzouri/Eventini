import { DEPENDENCY_PROBE_TIMEOUT_MS } from './health.constants';

export interface ProbeOutcome {
  readonly ok: boolean;
  readonly durationMs: number;
  readonly reason?: string;
}

/**
 * Runs a dependency check under a hard timeout and never throws.
 *
 * Both properties matter for a readiness probe. Never throwing means one
 * unreachable dependency reports *itself* as down instead of collapsing the
 * whole health check into a 500 that says nothing about which dependency
 * failed. The timeout means a dependency that accepts the connection and then
 * hangs — a saturated connection pool, a half-open TCP socket — is reported
 * as down rather than left to the orchestrator's own probe timeout, which
 * loses the reason.
 *
 * The reason is a short classification, never the driver's raw message: that
 * text routinely contains the connection string, and this value is returned
 * over HTTP.
 */
export async function probeDependency(
  check: () => Promise<unknown>,
  timeoutMs: number = DEPENDENCY_PROBE_TIMEOUT_MS,
): Promise<ProbeOutcome> {
  const startedAt = Date.now();
  let timer: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      check(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);

    return { ok: true, durationMs: Date.now() - startedAt };
  } catch (error) {
    const timedOut = error instanceof Error && error.message === 'timeout';

    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      reason: timedOut ? 'timeout' : 'unreachable',
    };
  } finally {
    // Without this the pending timer keeps the event loop alive, and a
    // process that has finished its work refuses to exit for up to the
    // timeout — which in a test run looks like a hang.
    if (timer) {
      clearTimeout(timer);
    }
  }
}
