import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request, Response } from 'express';

import { cookiesConfig } from '../../../config/cookies.config';
import { csrfConfig } from '../../../config/csrf.config';
import { CsrfTokenService } from './csrf-token.service';
import {
  anonymousContext,
  kindOf,
  sessionContext,
  type CsrfContextKind,
} from './domain/csrf-context';
import { equalsInConstantTime } from './domain/csrf-token';
import {
  clearCsrfCookies,
  readCsrfCookie,
  setCsrfCookies,
  type CsrfCookieSettings,
} from './infrastructure/csrf-cookies';

export interface IssuedCsrf {
  readonly token: string;
  readonly headerName: string;
  readonly mode: CsrfContextKind;
  readonly expiresAt: Date | null;
}

/**
 * The binding is always the value of `__Host-eventini_csrf_ctx`, and the
 * whole of ADR-0016 is what that value contains: an anonymous identifier
 * before login, the session identifier after it.
 *
 * Deriving the session binding from the context cookie rather than from the
 * access token is deliberate. An access token expires every few minutes while
 * its session lives for hours, and the one request that must work at exactly
 * that moment is the rotation `POST` — reading the binding off the access
 * token would make CSRF fail precisely when the token needed refreshing.
 */
@Injectable()
export class CsrfService {
  constructor(
    private readonly tokens: CsrfTokenService,
    @Inject(cookiesConfig.KEY)
    private readonly cookies: ConfigType<typeof cookiesConfig>,
    @Inject(csrfConfig.KEY)
    private readonly csrf: ConfigType<typeof csrfConfig>,
  ) {}

  /**
   * An existing context is reused rather than rotated: rotating would void
   * whatever token the client is already holding, and a second tab asking for
   * a token would break the first. Nothing is authenticated behind an
   * anonymous context, so there is no fixation to rotate away from — login is
   * where the binding changes, and that is `bindToSession`.
   */
  issue(request: Request, response: Response): IssuedCsrf {
    const context =
      readCsrfCookie(request, this.cookies.csrfContext.name) ??
      anonymousContext();

    return this.emit(response, context);
  }

  /**
   * Rebinding at login. The anonymous context is overwritten, so a token
   * captured before authentication no longer verifies against anything the
   * browser will send afterwards.
   */
  bindToSession(response: Response, sessionId: string): IssuedCsrf {
    return this.emit(response, sessionContext(sessionId));
  }

  clear(response: Response): void {
    clearCsrfCookies(response, this.cookieSettings());
  }

  /** Steps 3 to 8 and 10 of §3.3; the guard owns steps 1 and 2. */
  validate(request: Request): boolean {
    const context = readCsrfCookie(request, this.cookies.csrfContext.name);
    const cookie = readCsrfCookie(request, this.cookies.csrf.name);
    const header = headerValue(request, this.csrf.headerName);

    if (context === undefined || cookie === undefined || header === undefined) {
      return false;
    }

    // Step 8, and the reason a captured pre-session token cannot be replayed
    // even by a client that kept the anonymous context alongside its session:
    // an authenticated request is only ever authorized by a session binding.
    if (
      readCsrfCookie(request, this.cookies.access.name) !== undefined &&
      kindOf(context) !== 'SESSION'
    ) {
      return false;
    }

    return (
      equalsInConstantTime(cookie, header) &&
      this.tokens.matches(context, cookie)
    );
  }

  private emit(response: Response, context: string): IssuedCsrf {
    const mode = kindOf(context);
    const expiresAt =
      mode === 'PRE_SESSION'
        ? new Date(Date.now() + this.csrf.contextTtl)
        : null;
    const token = this.tokens.issue(context);

    setCsrfCookies(response, this.cookieSettings(), {
      context,
      token,
      expiresAt,
    });

    return { token, headerName: this.csrf.headerName, mode, expiresAt };
  }

  private cookieSettings(): CsrfCookieSettings {
    return {
      secure: this.cookies.secure,
      token: this.cookies.csrf,
      context: this.cookies.csrfContext,
    };
  }
}

function headerValue(request: Request, name: string): string | undefined {
  const raw = request.headers[name.toLowerCase()];

  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}
