import { probeDependency } from './dependency-probe';

describe('probeDependency', () => {
  it('reports ok when the check resolves', async () => {
    const outcome = await probeDependency(() => Promise.resolve('pong'));

    expect(outcome.ok).toBe(true);
    expect(outcome.reason).toBeUndefined();
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
  });

  /**
   * A readiness check must never throw: one unreachable dependency has to
   * report itself down, not collapse the whole probe into a 500 that says
   * nothing about which dependency failed.
   */
  it('reports unreachable instead of throwing when the check rejects', async () => {
    const outcome = await probeDependency(() =>
      Promise.reject(new Error('ECONNREFUSED')),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('unreachable');
  });

  it('reports timeout when the check hangs past the deadline', async () => {
    const outcome = await probeDependency(
      () => new Promise(() => undefined),
      20,
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('timeout');
  });

  /**
   * The driver's message routinely contains the connection string, and this
   * value is returned over HTTP.
   */
  it('never surfaces the underlying error message', async () => {
    const outcome = await probeDependency(() =>
      Promise.reject(
        new Error('connect ECONNREFUSED postgresql://user:hunter2@db:5432'),
      ),
    );

    expect(JSON.stringify(outcome)).not.toContain('hunter2');
    expect(JSON.stringify(outcome)).not.toContain('postgresql://');
  });

  it('handles a thrown non-Error without leaking it either', async () => {
    // Thrown rather than `Promise.reject`d: a driver that throws a bare
    // string is the case under test, and this is how it reaches us.
    const outcome = await probeDependency(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'raw string with secret hunter2';
    });

    expect(outcome.ok).toBe(false);
    expect(JSON.stringify(outcome)).not.toContain('hunter2');
  });

  /**
   * A leaked timer keeps the event loop alive, so a finished process refuses
   * to exit for up to the timeout — which looks like a hang.
   */
  it('clears its timer on success, leaving no pending handle', async () => {
    const before = process.getActiveResourcesInfo().length;
    await probeDependency(() => Promise.resolve('ok'), 60_000);
    const after = process.getActiveResourcesInfo().length;

    expect(after).toBeLessThanOrEqual(before);
  });
});
