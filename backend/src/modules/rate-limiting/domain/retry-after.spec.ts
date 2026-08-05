import { jitteredRetryAfter } from './retry-after';

describe('jitteredRetryAfter', () => {
  it('stays within ±10% of the requested wait', () => {
    const values = Array.from({ length: 200 }, () => jitteredRetryAfter(100));

    expect(Math.min(...values)).toBeGreaterThanOrEqual(90);
    expect(Math.max(...values)).toBeLessThanOrEqual(110);
  });

  /**
   * The point of the jitter: without it every client refused in one window
   * comes back on the same second and rebuilds the spike the limiter just
   * flattened.
   */
  it('does not return the same value every time', () => {
    const values = new Set(
      Array.from({ length: 200 }, () => jitteredRetryAfter(100)),
    );

    expect(values.size).toBeGreaterThan(5);
  });

  it.each([[0], [-1]])('never returns less than a second for %i', (given) => {
    expect(jitteredRetryAfter(given)).toBeGreaterThanOrEqual(1);
  });

  it('keeps a one-second wait at one second or more', () => {
    const values = Array.from({ length: 100 }, () => jitteredRetryAfter(1));

    expect(Math.min(...values)).toBeGreaterThanOrEqual(1);
  });
});
