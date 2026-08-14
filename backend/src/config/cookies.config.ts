import { registerAs } from '@nestjs/config';

import { getValidatedEnv } from './validated-env';

/**
 * Cookie contract from AUTHENTICATION_AUTHORIZATION.md §2 and ADR-0016.
 *
 * No web token is ever readable from JavaScript (AUTH-INV-001). The only
 * JS-readable cookie is the CSRF token, which carries no authorization.
 */
export const cookiesConfig = registerAs('cookies', () => {
  const env = getValidatedEnv();

  return {
    secret: env.COOKIE_SECRET,
    // false is permitted only in local development; the production hardening
    // rule refuses it when NODE_ENV=production.
    secure: env.COOKIE_SECURE,

    access: {
      name: env.COOKIE_ACCESS_NAME,
      httpOnly: true,
      sameSite: env.COOKIE_SAMESITE_ACCESS,
      path: '/',
    },

    refresh: {
      name: env.COOKIE_REFRESH_NAME,
      httpOnly: true,
      // Strict: a refresh is never triggered by an inbound navigation, so
      // Strict costs nothing here and removes a whole attack class.
      sameSite: env.COOKIE_SAMESITE_REFRESH,
      // Scoped so the refresh token is not sent to the rest of the API; a flaw
      // elsewhere cannot expose it.
      path: env.COOKIE_REFRESH_PATH,
    },

    csrf: {
      name: env.COOKIE_CSRF_NAME,
      // Readable by design: the client must echo it into X-CSRF-Token.
      httpOnly: false,
      sameSite: 'lax' as const,
      path: '/',
    },

    csrfContext: {
      name: env.COOKIE_CSRF_CONTEXT_NAME,
      httpOnly: true,
      sameSite: 'lax' as const,
      path: '/',
    },
  };
});
