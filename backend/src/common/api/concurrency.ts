import type { Request } from 'express';

import { AppException } from './app-exception';

/**
 * Optimistic concurrency — EVT-032, `IDEMPOTENCY_AND_CONCURRENCY.md` §8.
 *
 * ## Why a blind write is refused rather than accepted
 *
 * Two administrators open the same organization. One renames it, the other
 * changes the slug a second later. Without a precondition the second write
 * simply wins, and the first person's change is gone with nothing anywhere to
 * say it ever existed — no error, no conflict, no audit trail that reads as a
 * loss.
 *
 * So `If-Match` is **required**, not optional. A caller that has not read the
 * resource cannot know its version, and a caller that has read it has the
 * header. `428 PRECONDITION_REQUIRED` says exactly that, and is deliberately
 * stricter than the RFC's "may".
 */

/**
 * The `ETag` for a row version.
 *
 * Quoted, per RFC 9110 §8.8.3 — an unquoted entity-tag is malformed, and some
 * intermediaries drop the header entirely rather than pass it on.
 *
 * Strong rather than weak (`W/`): the version changes on every write, so two
 * representations sharing a tag are byte-identical, which is what strength
 * means here.
 */
export function toETag(version: number): string {
  return `"${String(version)}"`;
}

/**
 * Reads `If-Match` as the version the caller believes it is editing.
 *
 * Throws rather than returning null: every call site would otherwise have to
 * remember which of the two failures applies, and the difference between
 * "you did not send it" and "the one you sent is stale" is exactly what the
 * caller needs to tell a user.
 */
export function requireIfMatch(request: Request): number {
  const header = request.header('if-match');

  if (header === undefined || header.trim() === '') {
    throw new AppException('PRECONDITION_REQUIRED', {
      detail:
        'This request must carry an If-Match header holding the ETag of the version being edited.',
    });
  }

  const value = header.trim();

  /*
    `If-Match: *` means "any current representation", which for a route that
    exists to prevent lost updates means "overwrite whatever is there". It is
    valid HTTP and refused here on purpose: accepting it would give every
    caller a documented way to opt out of the guarantee.
  */
  if (value === '*') {
    throw new AppException('PRECONDITION_REQUIRED', {
      detail:
        'If-Match: * is not accepted here. Send the ETag returned by the last read.',
    });
  }

  const version = parseVersion(value);

  if (version === null) {
    // Malformed, not stale — but `412` is the honest answer either way: the
    // precondition could not be satisfied. Reporting `400` would invite the
    // caller to fix their syntax and retry blindly, which is the behaviour
    // this header exists to prevent.
    throw new AppException('PRECONDITION_FAILED', {
      detail: 'The If-Match header is not a valid ETag.',
    });
  }

  return version;
}

/**
 * Parses `"3"`, `W/"3"` and a bare `3`.
 *
 * The weak prefix is accepted on the way in even though it is never produced
 * on the way out: an intermediary may weaken a tag it re-serialises, and
 * refusing the result would break a caller who did everything right.
 *
 * A list — `If-Match: "3", "4"` — is refused. It means "any of these", which
 * on a single-version row can only be an accident.
 */
function parseVersion(value: string): number | null {
  if (value.includes(',')) {
    return null;
  }

  const unwrapped = /^(?:W\/)?"(.*)"$/.exec(value)?.[1] ?? value;

  // `Number` accepts "", " ", "0x10" and "1e3"; none of those is a version.
  if (!/^\d+$/.test(unwrapped)) {
    return null;
  }

  const version = Number(unwrapped);

  return Number.isSafeInteger(version) && version > 0 ? version : null;
}

/**
 * The failure of a versioned write, once the row has been re-read.
 *
 * `NOT_FOUND` and `CONFLICT` are separated because they are different answers
 * to the caller: one means the resource is gone, the other that it moved on.
 */
export type VersionedWriteFailure = 'NOT_FOUND' | 'CONFLICT';

/**
 * Turns a failed versioned write into the response it deserves.
 *
 * `409` rather than `412` on a version mismatch, and the distinction is worth
 * stating: `412` says the precondition was not met, `409` says the resource
 * changed underneath you. Both are defensible; `409 VERSION_CONFLICT` is what
 * `API_CONVENTIONS.md` §9 specifies, and it is the one a client can act on by
 * re-reading and merging.
 */
export function versionedWriteException(
  failure: VersionedWriteFailure,
  resource: string,
): AppException {
  return failure === 'NOT_FOUND'
    ? new AppException('RESOURCE_NOT_FOUND', {
        detail: `${resource} was not found.`,
      })
    : new AppException('VERSION_CONFLICT', {
        detail: `${resource} was modified by someone else. Re-read it and apply your change again.`,
        retryable: true,
      });
}
