import type { IdempotencyMeta } from './problem-details.types';

/**
 * How the idempotency interceptor tells the envelope what happened.
 *
 * A symbol on the request rather than a return value, because the two live at
 * different levels: `ResponseEnvelopeInterceptor` and `HttpExceptionFilter`
 * both build `meta`, and neither is on the path a replayed response takes back
 * out. A symbol key cannot collide with an Express property or with anything
 * a body parser puts there.
 *
 * The marker is set for a replay only. `meta.idempotency` is absent on a first
 * execution, which is deliberate: `replayed: false` on every response would be
 * noise on the overwhelming majority of them, and §7 only specifies the shape
 * for the replay case.
 */
const IDEMPOTENCY_META = Symbol('eventini:idempotency-meta');

interface Carrier {
  [IDEMPOTENCY_META]?: IdempotencyMeta;
}

export function attachIdempotencyMeta(
  request: object,
  meta: IdempotencyMeta,
): void {
  (request as Carrier)[IDEMPOTENCY_META] = meta;
}

export function idempotencyMetaOf(
  request: object,
): IdempotencyMeta | undefined {
  return (request as Carrier)[IDEMPOTENCY_META];
}
