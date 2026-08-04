import type { CookieOptions, Response } from 'express';

export interface CookieSpec {
  readonly name: string;
  readonly httpOnly: boolean;
  readonly sameSite: 'strict' | 'lax' | 'none';
  readonly path: string;
}

export interface SessionCookieSettings {
  readonly secure: boolean;
  readonly access: CookieSpec;
  readonly refresh: CookieSpec;
}

function optionsFor(spec: CookieSpec, secure: boolean): CookieOptions {
  return {
    httpOnly: spec.httpOnly,
    sameSite: spec.sameSite,
    path: spec.path,
    secure,
  };
}

/**
 * AUTH-INV-001: no web token is ever readable from JavaScript. Both of these
 * are `httpOnly` by configuration, and the CSRF cookie — the only readable
 * one — is EVT-028's, not set here.
 *
 * `expires` rather than `maxAge`, so the cookie dies with the token it
 * carries instead of outliving it by whatever the clock drifted.
 */
export function setSessionCookies(
  response: Response,
  settings: SessionCookieSettings,
  tokens: {
    accessToken: string;
    accessTokenExpiresAt: Date;
    refreshToken: string;
    refreshTokenExpiresAt: Date;
  },
): void {
  response.cookie(settings.access.name, tokens.accessToken, {
    ...optionsFor(settings.access, settings.secure),
    expires: tokens.accessTokenExpiresAt,
  });

  response.cookie(settings.refresh.name, tokens.refreshToken, {
    ...optionsFor(settings.refresh, settings.secure),
    expires: tokens.refreshTokenExpiresAt,
  });
}

/**
 * Clearing replays every attribute the cookie was set with, `httpOnly`
 * included. Document B §14.4 omitted it (C-19); some browsers then fail to
 * match the cookie and leave it in place, which is a logout that does not log
 * anybody out.
 */
export function clearSessionCookies(
  response: Response,
  settings: SessionCookieSettings,
): void {
  for (const spec of [settings.access, settings.refresh]) {
    response.clearCookie(spec.name, optionsFor(spec, settings.secure));
  }
}
