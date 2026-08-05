import { randomBytes } from 'node:crypto';

const ANONYMOUS_PREFIX = 'anon:';
const SESSION_PREFIX = 'sid:';
const ANONYMOUS_BYTES = 32;

export type CsrfContextKind = 'PRE_SESSION' | 'SESSION';

/**
 * The value of the `__Host-eventini_csrf_ctx` cookie, and the binding every
 * token is signed over.
 *
 * The two namespaces are tagged rather than left bare so an anonymous
 * identifier can never be presented as a session identifier, whatever the
 * shape of either one becomes later.
 *
 * Neither tag may be `s:`, which `cookie-parser` reserves for its signed-cookie
 * marker: a value starting with it is unsigned and, when that fails, handed
 * back as `false` rather than the string that was stored.
 */
export function anonymousContext(): string {
  return `${ANONYMOUS_PREFIX}${randomBytes(ANONYMOUS_BYTES).toString('base64url')}`;
}

export function sessionContext(sessionId: string): string {
  return `${SESSION_PREFIX}${sessionId}`;
}

export function kindOf(context: string): CsrfContextKind {
  return context.startsWith(SESSION_PREFIX) ? 'SESSION' : 'PRE_SESSION';
}
