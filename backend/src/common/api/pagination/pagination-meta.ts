import type { PaginationMeta } from '../problem-details.types';

/**
 * How a list handler hands its pagination to the envelope.
 *
 * The same symbol-on-the-request mechanism as `idempotency-meta.ts`, for the
 * same reason: `ResponseEnvelopeInterceptor` builds `meta`, and a handler
 * returning `{ items, pagination }` instead of its items would make `data`
 * the wrong shape for exactly the routes that page.
 */
const PAGINATION_META = Symbol('eventini:pagination-meta');

interface Carrier {
  [PAGINATION_META]?: PaginationMeta;
}

export function attachPaginationMeta(
  request: object,
  meta: PaginationMeta,
): void {
  (request as Carrier)[PAGINATION_META] = meta;
}

export function paginationMetaOf(request: object): PaginationMeta | undefined {
  return (request as Carrier)[PAGINATION_META];
}
