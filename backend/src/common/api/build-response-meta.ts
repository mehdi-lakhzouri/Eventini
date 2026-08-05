import type { IdempotencyMeta, ResponseMeta } from './problem-details.types';

/** The path prefix is the source of truth for the version — this just echoes it. */
const API_VERSION = 'v1';

export function buildResponseMeta(
  requestId: string,
  idempotency?: IdempotencyMeta,
): ResponseMeta {
  return {
    requestId,
    timestamp: new Date().toISOString(),
    apiVersion: API_VERSION,
    // Spread rather than `idempotency: idempotency` so the key is absent on
    // an ordinary response instead of present and undefined — `JSON.stringify`
    // drops both, but only one of them survives a deep equality assertion.
    ...(idempotency === undefined ? {} : { idempotency }),
  };
}
