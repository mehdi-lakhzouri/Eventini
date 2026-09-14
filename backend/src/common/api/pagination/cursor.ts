import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { canonicalJson } from '../../idempotency/canonical-json';

/**
 * Opaque, signed pagination cursors — API_CONVENTIONS.md §6, THREAT_MODEL.md T-5.
 *
 * A cursor is `base64url(payload) "." base64url(HMAC-SHA256(payload))`. The
 * payload holds the boundary row's sort value and id — the keyset — and a
 * hash of the canonical query the cursor was issued for.
 *
 * ## Why signed, when the tenant filter is applied server-side anyway
 *
 * A forged keyset cannot reach another tenant's rows: every list query is
 * scoped by the `TenantContext`, not by anything in the cursor. What the
 * signature buys is that a cursor is *only* ever something this server
 * produced, so a tampered one is a clean `400` and never a query built on
 * values nobody validated — the contract test "curseur trafiqué ⇒ 400, jamais
 * 500" has no parsing edge case left to find.
 *
 * ## Why the query scope is embedded
 *
 * A keyset is only meaningful under the ordering and filters that produced it.
 * `lastName = "Martin"` read as a `createdAt` boundary is garbage, and a cursor
 * from organization A replayed in organization B is a position in a result set
 * that does not exist. The scope hash makes both a refusal instead of a
 * silently wrong page.
 */

/** The boundary row: its sort value, then its id as the tie-breaker. */
export type CursorKey = readonly [sortValue: string, id: string];

export interface CursorPayload {
  readonly scope: string;
  readonly key: CursorKey;
}

const CURSOR_VERSION = 1;

/**
 * Well above anything this server emits — a scope hash, an ISO timestamp or a
 * 200-character name, and an id — and low enough that a hostile value is
 * refused before any decoding work is spent on it.
 */
export const MAX_CURSOR_LENGTH = 1024;

/** 128 bits, base64url: collision-resistant enough to tell two queries apart. */
const SCOPE_HASH_LENGTH = 22;

export function paginationScope(parts: Record<string, unknown>): string {
  return createHash('sha256')
    .update(canonicalJson(parts), 'utf8')
    .digest('base64url')
    .slice(0, SCOPE_HASH_LENGTH);
}

export function signCursor(payload: CursorPayload, key: Buffer): string {
  const body = Buffer.from(
    JSON.stringify({ v: CURSOR_VERSION, s: payload.scope, k: payload.key }),
    'utf8',
  ).toString('base64url');

  return `${body}.${mac(body, key)}`;
}

/**
 * The payload of a cursor this server signed, or `null` for anything else —
 * malformed, truncated, re-signed, or from an older cursor version.
 *
 * `null` rather than a reason: the caller's only useful answer to any of them
 * is the same `400`, and distinguishing "bad signature" from "bad JSON" would
 * tell a prober which half of a forgery worked.
 */
export function verifyCursor(token: string, key: Buffer): CursorPayload | null {
  if (token.length === 0 || token.length > MAX_CURSOR_LENGTH) {
    return null;
  }

  const separator = token.indexOf('.');
  if (separator <= 0 || separator !== token.lastIndexOf('.')) {
    return null;
  }

  const body = token.slice(0, separator);
  const presented = Buffer.from(token.slice(separator + 1), 'base64url');
  const expected = Buffer.from(mac(body, key), 'base64url');

  if (
    presented.length !== expected.length ||
    !timingSafeEqual(presented, expected)
  ) {
    return null;
  }

  return parsePayload(body);
}

function parsePayload(body: string): CursorPayload | null {
  let decoded: unknown;

  try {
    decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (decoded === null || typeof decoded !== 'object') {
    return null;
  }

  const { v, s, k } = decoded as Record<string, unknown>;

  if (
    v !== CURSOR_VERSION ||
    typeof s !== 'string' ||
    !Array.isArray(k) ||
    k.length !== 2 ||
    typeof k[0] !== 'string' ||
    typeof k[1] !== 'string'
  ) {
    return null;
  }

  return { scope: s, key: [k[0], k[1]] };
}

function mac(body: string, key: Buffer): string {
  return createHmac('sha256', key).update(body, 'utf8').digest('base64url');
}
