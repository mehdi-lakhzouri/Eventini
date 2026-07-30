/**
 * CSRF transport concern. Lives in `lib/api/` rather than in the authentication
 * feature because `api-client.ts` needs it on every mutating request, and
 * `MODULE_DEPENDENCY_MAP.md` §7 forbids `lib/` from importing a feature.
 *
 * Names follow the contract in `AUTHENTICATION_AUTHORIZATION.md` §2 and
 * ADR-0016. The cookie was `csrf-token` here, which matched nothing on either
 * side — the backend has no CSRF implementation yet, so aligning the client to
 * the specification now is what makes the two meet when EVT-028 lands.
 */

/** Readable by JavaScript on purpose: it carries no authorization. */
export const CSRF_COOKIE_NAME = "__Host-eventini_csrf";

export const CSRF_HEADER_NAME = "X-CSRF-Token";

/**
 * Reads the double-submit token.
 *
 * Returns `null` on the server, where `document` does not exist: a Server
 * Component rendering this path must not crash, it simply has no token to send.
 */
export function readCsrfToken(): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${CSRF_COOKIE_NAME}=`));

  if (cookie === undefined) {
    return null;
  }

  // slice, not split("="): a base64url token can legitimately contain "=" and
  // splitting would silently truncate it.
  const value = cookie.slice(CSRF_COOKIE_NAME.length + 1);

  return value === "" ? null : decodeURIComponent(value);
}

/**
 * Adds the CSRF header when a token is available, leaving the request untouched
 * when it is not.
 *
 * Sending an empty header would be worse than sending none: the server would
 * compare an empty header against a real cookie and record a mismatch that
 * looks like an attack in `security_events`.
 */
export function withCsrfHeader(headers: HeadersInit = {}): Headers {
  const token = readCsrfToken();
  const nextHeaders = new Headers(headers);

  if (token !== null) {
    nextHeaders.set(CSRF_HEADER_NAME, token);
  }

  return nextHeaders;
}
