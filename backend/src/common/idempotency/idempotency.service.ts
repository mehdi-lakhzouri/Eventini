import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../types/tenant-context';
import {
  IDEMPOTENCY_RETENTION_SECONDS,
  IN_FLIGHT_LOCK_SECONDS,
  type IdempotencyRetention,
} from './idempotency.constants';
import {
  IdempotencyRepository,
  type IdempotencyRecordView,
  type IdempotencyScope,
} from './idempotency.repository';
import type { StoredResponse } from './stored-response';

export interface BeginInput {
  readonly scope: IdempotencyScope;
  readonly requestHash: string;
  readonly actorSessionId: string | null;
  readonly retention: IdempotencyRetention;
  readonly now: Date;
}

export type IdempotencyDecision =
  /** The claim is ours; run the handler and settle the record afterwards. */
  | { readonly kind: 'EXECUTE'; readonly recordId: string }
  /** A previous attempt already answered; return that answer. */
  | {
      readonly kind: 'REPLAY';
      readonly response: StoredResponse;
      readonly status: number;
    }
  /** Someone else holds the claim right now. */
  | { readonly kind: 'IN_FLIGHT' }
  /** Same key, different request. */
  | { readonly kind: 'CONFLICT' };

/**
 * The five-state machine of IDEMPOTENCY_AND_CONCURRENCY.md §5.
 *
 * It never blocks and never polls. A key held by another request in flight is
 * answered `409` with `Retry-After`, not awaited — ADR-0012's reasoning is
 * that a waiting client holds a server connection, and under offline sync,
 * with several devices replaying batches at once, that exhausts the pool
 * before it exhausts anything else. Moving the wait to the client puts it
 * where it is free, and the mobile client already backs off for network
 * failures.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly records: IdempotencyRepository) {}

  async begin(
    context: TenantContext,
    input: BeginInput,
  ): Promise<IdempotencyDecision> {
    const claimed = await this.claim(context, input);

    if (claimed !== null) {
      return { kind: 'EXECUTE', recordId: claimed };
    }

    const existing = await this.records.find(context, input.scope);

    // The key was taken a moment ago and is gone now — a retention purge
    // landed between the two statements. One retry, then give up rather than
    // loop: a second failure means something other than a purge is happening.
    if (existing === null) {
      const retried = await this.claim(context, input);

      return retried === null
        ? { kind: 'CONFLICT' }
        : { kind: 'EXECUTE', recordId: retried };
    }

    return this.decide(context, input, existing);
  }

  /**
   * Records a successful or definitively failed execution.
   *
   * `FAILED_RETRYABLE` deliberately keeps no response: the next attempt
   * re-executes, so a stored body would only be a chance to answer with a
   * transient error that has since stopped happening.
   */
  async complete(
    context: TenantContext,
    input: {
      readonly recordId: string;
      readonly responseStatus: number;
      readonly response: StoredResponse;
    },
  ): Promise<void> {
    await this.records.settle(context, {
      recordId: input.recordId,
      status: 'COMPLETED',
      responseStatus: input.responseStatus,
      response: input.response,
    });
  }

  async failFinal(
    context: TenantContext,
    input: {
      readonly recordId: string;
      readonly responseStatus: number;
      readonly response: StoredResponse;
    },
  ): Promise<void> {
    await this.records.settle(context, {
      recordId: input.recordId,
      status: 'FAILED_FINAL',
      responseStatus: input.responseStatus,
      response: input.response,
    });
  }

  async failRetryable(
    context: TenantContext,
    input: { readonly recordId: string; readonly responseStatus: number },
  ): Promise<void> {
    await this.records.settle(context, {
      recordId: input.recordId,
      status: 'FAILED_RETRYABLE',
      responseStatus: input.responseStatus,
      response: null,
    });
  }

  private async claim(
    context: TenantContext,
    input: BeginInput,
  ): Promise<string | null> {
    return this.records.claim(context, {
      scope: input.scope,
      requestHash: input.requestHash,
      actorSessionId: input.actorSessionId,
      expiresAt: expiryOf(input.now, input.retention),
      lockedUntil: lockUntil(input.now),
    });
  }

  private async decide(
    context: TenantContext,
    input: BeginInput,
    existing: IdempotencyRecordView,
  ): Promise<IdempotencyDecision> {
    // Expiry is checked before the fingerprint, and the order is the whole
    // meaning of "an expired key is treated as a first request" (§5): a first
    // request has nothing to conflict with, so a different body is not a
    // conflict here, it is a different request reusing a key nobody owns.
    if (
      existing.status === 'EXPIRED' ||
      existing.expiresAt.getTime() <= input.now.getTime()
    ) {
      return this.takeOver(context, input, existing);
    }

    if (existing.requestHash !== input.requestHash) {
      return { kind: 'CONFLICT' };
    }

    switch (existing.status) {
      case 'PENDING':
        return this.holdsClaim(existing, input.now)
          ? { kind: 'IN_FLIGHT' }
          : this.takeOver(context, input, existing);

      case 'COMPLETED':
      case 'FAILED_FINAL':
        return existing.response === null
          ? // The row says it answered but the answer is unreadable — an older
            // release's shape, or a truncated write. Re-running is the safe
            // reading: the business write has its own uniqueness.
            this.takeOver(context, input, existing)
          : {
              kind: 'REPLAY',
              response: existing.response,
              status: existing.responseStatus ?? 200,
            };

      case 'FAILED_RETRYABLE':
        return this.takeOver(context, input, existing);
    }
  }

  /** `PENDING` and still within its lock — someone is running it right now. */
  private holdsClaim(record: IdempotencyRecordView, now: Date): boolean {
    return (
      record.lockedUntil !== null &&
      record.lockedUntil.getTime() > now.getTime()
    );
  }

  private async takeOver(
    context: TenantContext,
    input: BeginInput,
    existing: IdempotencyRecordView,
  ): Promise<IdempotencyDecision> {
    const taken = await this.records.reclaim(context, {
      recordId: existing.id,
      expectedStatus: existing.status,
      expectedLockedUntil: existing.lockedUntil,
      requestHash: input.requestHash,
      expiresAt: expiryOf(input.now, input.retention),
      lockedUntil: lockUntil(input.now),
    });

    // Lost the race to another request that observed the same lapsed row.
    // In flight is the truth from here: it is running, we are not.
    return taken
      ? { kind: 'EXECUTE', recordId: existing.id }
      : { kind: 'IN_FLIGHT' };
  }
}

function expiryOf(now: Date, retention: IdempotencyRetention): Date {
  return new Date(
    now.getTime() + IDEMPOTENCY_RETENTION_SECONDS[retention] * 1000,
  );
}

function lockUntil(now: Date): Date {
  return new Date(now.getTime() + IN_FLIGHT_LOCK_SECONDS * 1000);
}
