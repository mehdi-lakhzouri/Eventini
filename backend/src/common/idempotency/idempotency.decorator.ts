import { SetMetadata } from '@nestjs/common';

import type { IdempotencyRetention } from './idempotency.constants';

export const IDEMPOTENT_KEY = 'eventini:idempotent';

export interface IdempotentOptions {
  readonly retention?: IdempotencyRetention;
}

export interface IdempotencySettings {
  readonly retention: IdempotencyRetention;
}

/**
 * Marks a route as replayable — IDEMPOTENCY_AND_CONCURRENCY.md §2.
 *
 * There is no `required: false`. On a route carrying this decorator a missing
 * `Idempotency-Key` is a `400`, because "optional idempotency" is idempotency
 * that stops working the day a client forgets, and the client that forgets is
 * the offline scanner replaying a batch.
 */
export const Idempotent = (options: IdempotentOptions = {}) =>
  SetMetadata<string, IdempotencySettings>(IDEMPOTENT_KEY, {
    retention: options.retention ?? '24h',
  });
