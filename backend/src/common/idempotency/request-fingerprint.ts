import { createHash } from 'node:crypto';

import { canonicalJson } from './canonical-json';

/**
 * The six parts of the fingerprint, in the order
 * IDEMPOTENCY_AND_CONCURRENCY.md §3 fixes them.
 *
 * `organizationId` and `actorId` are in the material even though they are
 * already in the unique index. They are there because the index answers "has
 * this key been used" and the hash answers "is this the same request" — and a
 * key that somehow reached a different tenant's row must read as a conflict
 * rather than as a replay.
 */
export interface FingerprintInput {
  readonly method: string;
  /** The route template, never the concrete URI. */
  readonly routeTemplate: string;
  readonly organizationId: string | null;
  readonly actorId: string;
  readonly body: unknown;
  /**
   * `string[]` because Express gives a wildcard segment its parts as an
   * array; `canonicalJson` orders neither, since a path's segments are
   * position-dependent.
   */
  readonly pathParams: Readonly<Record<string, string | string[]>>;
}

const SEPARATOR = '\n';

/**
 * SHA-256 of the canonical request material.
 *
 * ## What is deliberately absent
 *
 * Every header. `traceparent`, `User-Agent`, `X-Request-Id`, `Date` and
 * `Authorization` all change between a request and its retry — that is what
 * they are for — so including any of them would make the fingerprint of a
 * legitimate replay differ from the original, and the mechanism would answer
 * `409 IDEMPOTENCY_CONFLICT` to precisely the retry it exists to absorb.
 *
 * The query string is absent for the same class of reason and one more: the
 * routes that require a key are all `POST`s whose intention lives in the body.
 *
 * ## Why the template and not the URI
 *
 * `/events/:eventId/check-ins` rather than `/events/evt_01/check-ins`. The
 * identifier is already in `pathParams`; counting it twice adds nothing, and
 * hashing the concrete URI would mean a route rename in the router silently
 * invalidated every key in flight.
 */
export function requestFingerprint(input: FingerprintInput): string {
  const material = [
    input.method.toUpperCase(),
    input.routeTemplate,
    input.organizationId ?? '',
    input.actorId,
    canonicalJson(input.body),
    canonicalJson(input.pathParams),
  ].join(SEPARATOR);

  return createHash('sha256').update(material, 'utf8').digest('hex');
}
