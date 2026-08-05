import type { IdempotencyStatus } from '../../infrastructure/database/enums';
import type { TenantContext } from '../types/tenant-context';
import type { StoredResponse } from './stored-response';

/**
 * The tuple `ux_idempotency_scope` is built on, minus the tenant — which
 * arrives separately as the `TenantContext` every method takes first.
 *
 * `actorId` is a user or a scanner device, so it is not `context.userId`: the
 * two coincide today and will not once devices authenticate on their own.
 */
export interface IdempotencyScope {
  readonly actorId: string;
  readonly method: string;
  readonly route: string;
  readonly key: string;
}

export interface ClaimInput {
  readonly scope: IdempotencyScope;
  readonly requestHash: string;
  readonly actorSessionId: string | null;
  readonly expiresAt: Date;
  readonly lockedUntil: Date;
}

export interface ReclaimInput {
  readonly recordId: string;
  /** Both halves of the compare-and-swap — see `reclaim`. */
  readonly expectedStatus: IdempotencyStatus;
  readonly expectedLockedUntil: Date | null;
  readonly requestHash: string;
  readonly expiresAt: Date;
  readonly lockedUntil: Date;
}

export interface SettleInput {
  readonly recordId: string;
  readonly status: IdempotencyStatus;
  readonly responseStatus: number;
  readonly response: StoredResponse | null;
}

export interface IdempotencyRecordView {
  readonly id: string;
  readonly status: IdempotencyStatus;
  readonly requestHash: string;
  readonly expiresAt: Date;
  readonly lockedUntil: Date | null;
  readonly responseStatus: number | null;
  readonly response: StoredResponse | null;
}

/**
 * Access to `idempotency_records` — ADR-0012.
 *
 * ## Why every method takes a `TenantContext`
 *
 * The table is classified `TENANT_OPTIONAL`, so the runtime guard does not
 * demand the filter: a platform operation legitimately has no organization.
 * That exemption is about what the *table* permits, not about what this
 * repository does. Every query it issues is scoped, the signature makes that
 * unforgeable, and `__architecture__/tenant-isolation.spec.ts` checks it —
 * which is the stronger of the two guarantees, since it fails in a test rather
 * than on the first cross-tenant read.
 *
 * The platform-scoped path (`organization_id IS NULL`, for
 * `POST /platform/organizations`) is therefore **not implemented here**. The
 * column and `ux_idempotency_scope_platform` exist so that path is a code
 * change rather than a migration on a hot table; giving it a home now would
 * mean widening this signature to something nullable, for a route that does
 * not exist until sprint 09.
 */
export abstract class IdempotencyRepository {
  /**
   * `INSERT ... ON CONFLICT DO NOTHING RETURNING id`, and the whole of the
   * concurrency control.
   *
   * Returns the new record id, or `null` when the key was already taken.
   * There is no read before the write, which is what Document C §19.6 asked
   * for when it wrote that "a simple find-then-insert is vulnerable": two
   * concurrent requests contend inside PostgreSQL's unique index, where
   * exactly one wins and no lock is involved.
   */
  abstract claim(
    context: TenantContext,
    input: ClaimInput,
  ): Promise<string | null>;

  abstract find(
    context: TenantContext,
    scope: IdempotencyScope,
  ): Promise<IdempotencyRecordView | null>;

  /**
   * Takes an existing row back to `PENDING` — an expired key, a retryable
   * failure, or a claim whose holder died.
   *
   * Conditional on the status and lock the caller observed, so it is a
   * compare-and-swap rather than a blind write: `false` means another request
   * got there first, and the caller must treat the key as in flight instead of
   * executing alongside it.
   */
  abstract reclaim(
    context: TenantContext,
    input: ReclaimInput,
  ): Promise<boolean>;

  /** Records the outcome and the response to replay. */
  abstract settle(context: TenantContext, input: SettleInput): Promise<void>;
}
