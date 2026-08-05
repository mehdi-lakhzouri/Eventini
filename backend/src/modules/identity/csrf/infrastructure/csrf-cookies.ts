import type { ConfigType } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';

import type { cookiesConfig } from '../../../../config/cookies.config';

type Cookies = ConfigType<typeof cookiesConfig>;

export interface CsrfCookieSettings {
  readonly secure: boolean;
  /** Readable by design — the client echoes it into `X-CSRF-Token`. */
  readonly token: Cookies['csrf'];
  /** `HttpOnly` — it names the context the token is signed over. */
  readonly context: Cookies['csrfContext'];
}

function optionsFor(
  spec: CsrfCookieSettings['token'],
  secure: boolean,
): CookieOptions {
  return {
    httpOnly: spec.httpOnly,
    sameSite: spec.sameSite,
    path: spec.path,
    secure,
  };
}

/**
 * `expires` is omitted for a session-bound context so the pair dies with the
 * browser session, exactly like the access cookie it travels with. The
 * anonymous context passes an expiry instead: ADR-0016 caps it at 30 minutes
 * because nothing is authenticated behind it yet.
 */
export function setCsrfCookies(
  response: Response,
  settings: CsrfCookieSettings,
  issued: { context: string; token: string; expiresAt: Date | null },
): void {
  const expiry =
    issued.expiresAt === null ? {} : { expires: issued.expiresAt };

  response.cookie(settings.context.name, issued.context, {
    ...optionsFor(settings.context, settings.secure),
    ...expiry,
  });

  response.cookie(settings.token.name, issued.token, {
    ...optionsFor(settings.token, settings.secure),
    ...expiry,
  });
}

/**
 * Clearing replays every attribute the cookie was set with, `httpOnly`
 * included — Document B §14.4 omitted it (C-19) and a browser that fails to
 * match the cookie leaves it in place.
 */
export function clearCsrfCookies(
  response: Response,
  settings: CsrfCookieSettings,
): void {
  for (const spec of [settings.context, settings.token]) {
    response.clearCookie(spec.name, optionsFor(spec, settings.secure));
  }
}

export function readCsrfCookie(
  request: Request,
  name: string,
): string | undefined {
  const cookies = (request as { cookies?: Record<string, unknown> }).cookies;
  const value = cookies?.[name];

  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
