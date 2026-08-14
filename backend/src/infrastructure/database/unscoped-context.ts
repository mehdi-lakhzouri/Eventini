import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The `$unscoped` escape hatch's context — sprint-03 EVT-018, ADR-0003.
 *
 * ## Why `AsyncLocalStorage` and not a parameter
 *
 * The alternative is threading a flag through every query call. That fails
 * for the reason flags always fail: the guard would then be something each
 * call site opts into, and a platform operation spanning four repositories
 * would have to remember it four times. `AsyncLocalStorage` makes the
 * exemption a property of the *call tree* — enter `$unscoped`, everything
 * underneath is exempt, leave it and the guard is back on — which is the
 * shape the exemption actually has.
 *
 * It also survives `await`, which a module-level boolean would not: two
 * concurrent requests, one inside `$unscoped` and one not, would otherwise
 * share the flag and the second would be silently exempted. That is a
 * cross-tenant read caused by a variable, and it is why this is not a
 * `let isUnscoped = false`.
 */

export interface UnscopedContext {
  /**
   * Why the exemption was taken. Required, not optional: a `warn` line saying
   * "an unscoped query ran" with no reason is noise that a reader learns to
   * skip, and this line is supposed to be alertable in production.
   */
  readonly reason: string;
}

const storage = new AsyncLocalStorage<UnscopedContext>();

/** Whether the current call tree is inside `$unscoped`. */
export function isUnscopedContext(): boolean {
  return storage.getStore() !== undefined;
}

/** The reason given for the current exemption, if there is one. */
export function currentUnscopedReason(): string | undefined {
  return storage.getStore()?.reason;
}

/**
 * Runs `work` with the tenant guard disabled.
 *
 * Nested calls are allowed and keep the innermost reason — a platform
 * operation calling a helper that also declares itself unscoped is a
 * legitimate shape, and making the inner call throw would push people to
 * remove the inner declaration, which is the more informative one.
 *
 * ## 🔴 Why the callback is awaited here, and not merely called
 *
 * The obvious implementation is `storage.run({ reason }, work)`. It does not
 * work, and it fails in the worst possible direction — found by testing the
 * escape hatch rather than by reasoning about it.
 *
 * A Prisma query is **lazy**: `client.event.findMany()` returns a
 * `PrismaPromise` that has not run anything yet, and the extension only fires
 * when something awaits it. With a bare `storage.run`, the callback returns
 * that unstarted promise, `run` pops the store, and the query then executes
 * *outside* the exemption — so `$unscoped(reason, () => …findMany())` threw a
 * `TenantScopeViolationError` despite being the one call that is supposed to
 * be allowed.
 *
 * Awaiting inside the context keeps it open until the query has actually run.
 * The failure was loud in that direction; the mirror image, had the default
 * been reversed, would have been an exemption that outlived its callback and
 * silently disabled the guard for whatever ran next.
 *
 * The reason check stays synchronous on purpose: passing no reason is a
 * programming error, and it should throw at the call site rather than reject
 * later, where a `.catch` might swallow it.
 */
export function runUnscoped<T>(
  reason: string,
  work: () => PromiseLike<T> | T,
): Promise<T> {
  if (reason.trim() === '') {
    throw new Error(
      '$unscoped requires a reason. It is written to a warn-level log that ' +
        'is alerted on in production, and an alert with no reason cannot be ' +
        'triaged.',
    );
  }

  return storage.run({ reason }, async () => work());
}
