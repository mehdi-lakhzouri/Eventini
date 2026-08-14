import {
  currentUnscopedReason,
  isUnscopedContext,
  runUnscoped,
} from './unscoped-context';

describe('runUnscoped', () => {
  it('is off by default', () => {
    expect(isUnscopedContext()).toBe(false);
    expect(currentUnscopedReason()).toBeUndefined();
  });

  it('exempts the callback and nothing after it', async () => {
    await runUnscoped('platform report', () => {
      expect(isUnscopedContext()).toBe(true);
      expect(currentUnscopedReason()).toBe('platform report');
    });

    expect(isUnscopedContext()).toBe(false);
  });

  it('returns what the callback returns', async () => {
    await expect(runUnscoped('r', () => 42)).resolves.toBe(42);
  });

  /**
   * 🔴 The regression this exists for.
   *
   * A Prisma query is lazy: calling it builds a promise that has not run
   * anything yet, and the extension only fires when something awaits it. The
   * first implementation was `storage.run({ reason }, work)`, which returned
   * that unstarted promise and popped the store before the query executed —
   * so the escape hatch threw a scope violation on the one call it exists to
   * permit. A deferred callback stands in for the lazy query here.
   */
  it('is still exempt when the work only starts on await', async () => {
    const deferred = runUnscoped('platform report', () => {
      return Promise.resolve().then(() => isUnscopedContext());
    });

    await expect(deferred).resolves.toBe(true);
  });

  /**
   * The property a module-level boolean would not have. `AsyncLocalStorage`
   * follows the call tree across `await`; a flag would not, and the exemption
   * would end at the first suspension point while the queries after it went
   * unguarded.
   */
  it('survives await inside the callback', async () => {
    await runUnscoped('async platform work', async () => {
      expect(isUnscopedContext()).toBe(true);
      await Promise.resolve();
      expect(isUnscopedContext()).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(isUnscopedContext()).toBe(true);
    });

    expect(isUnscopedContext()).toBe(false);
  });

  /**
   * 🔴 The failure mode that makes this worth a test rather than a comment.
   *
   * With a shared boolean, a request inside `$unscoped` would exempt every
   * concurrent request for as long as it ran — a cross-tenant read caused by
   * a variable, appearing only under load, and impossible to reproduce from
   * a single request.
   */
  it('does not leak into concurrent work', async () => {
    const observations: boolean[] = [];

    await Promise.all([
      runUnscoped('platform', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        observations.push(isUnscopedContext());
      }),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        observations.push(isUnscopedContext());
        await new Promise((resolve) => setTimeout(resolve, 6));
        observations.push(isUnscopedContext());
      })(),
    ]);

    // The exempt branch sees true; the ordinary one never does, including
    // while the exempt branch is mid-flight.
    expect(observations.filter(Boolean)).toHaveLength(1);
  });

  it('does not exempt a callback that merely escapes the scope', async () => {
    let escaped: (() => boolean) | undefined;

    await runUnscoped('platform', () => {
      escaped = () => isUnscopedContext();
    });

    // Called outside the `run`, so the store is gone even though the closure
    // was created inside it.
    expect(escaped?.()).toBe(false);
  });

  describe('nesting', () => {
    it('keeps the innermost reason', async () => {
      await runUnscoped('outer', async () => {
        await runUnscoped('inner', () => {
          expect(currentUnscopedReason()).toBe('inner');
        });

        expect(currentUnscopedReason()).toBe('outer');
      });
    });
  });

  describe('the reason is mandatory', () => {
    it.each(['', '   ', '\t'])('rejects the reason %j', (reason) => {
      expect(() => runUnscoped(reason, () => 1)).toThrow(/requires a reason/);
    });

    it('does not enter the exemption when it rejects', () => {
      expect(() =>
        runUnscoped('', () => {
          throw new Error('should never run');
        }),
      ).toThrow(/requires a reason/);

      expect(isUnscopedContext()).toBe(false);
    });
  });

  it('restores the previous state when the callback throws', async () => {
    await expect(
      runUnscoped('platform', () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(isUnscopedContext()).toBe(false);
  });

  it('restores it when an async callback rejects', async () => {
    await expect(
      runUnscoped('platform', async () => {
        await Promise.resolve();
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(isUnscopedContext()).toBe(false);
  });
});
