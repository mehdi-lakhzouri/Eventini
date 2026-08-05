import type { ConfigType } from '@nestjs/config';
import type { Request, Response } from 'express';

import type { cookiesConfig } from '../../../config/cookies.config';
import type { csrfConfig } from '../../../config/csrf.config';
import { CsrfService } from './csrf.service';
import { CsrfTokenService } from './csrf-token.service';

const CONTEXT_COOKIE = '__Host-eventini_csrf_ctx';
const TOKEN_COOKIE = '__Host-eventini_csrf';
const ACCESS_COOKIE = '__Host-eventini_access';

const COOKIES = {
  secure: true,
  // `access` is read by `validate`, which refuses a request that carries a
  // session cookie but only a pre-session CSRF context. Omitting it here
  // would make the fixture, not the service, decide the outcome.
  access: { name: ACCESS_COOKIE, httpOnly: true, sameSite: 'lax', path: '/' },
  csrf: { name: TOKEN_COOKIE, httpOnly: false, sameSite: 'lax', path: '/' },
  csrfContext: {
    name: CONTEXT_COOKIE,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  },
} as unknown as ConfigType<typeof cookiesConfig>;

const CSRF = {
  secret: 'a-secret-that-only-the-server-knows',
  contextTtl: 1_800_000,
  headerName: 'X-CSRF-Token',
} as unknown as ConfigType<typeof csrfConfig>;

/** Records what a real Express response would have written. */
function recorder() {
  const jar = new Map<string, string>();
  const cleared: string[] = [];

  const response = {
    cookie: (name: string, value: string) => jar.set(name, value),
    clearCookie: (name: string) => cleared.push(name),
  } as unknown as Response;

  return { response, jar, cleared };
}

function requestWith(
  cookies: Record<string, string>,
  header?: string,
): Request {
  return {
    cookies,
    headers: header === undefined ? {} : { 'x-csrf-token': header },
  } as unknown as Request;
}

function service(): CsrfService {
  return new CsrfService(new CsrfTokenService(CSRF), COOKIES, CSRF);
}

describe('CsrfService', () => {
  describe('pre-session issuance', () => {
    it('mints an anonymous context and a token bound to it', () => {
      const { response, jar } = recorder();
      const issued = service().issue(requestWith({}), response);

      expect(issued.mode).toBe('PRE_SESSION');
      expect(jar.get(CONTEXT_COOKIE)).toMatch(/^anon:/);
      expect(jar.get(TOKEN_COOKIE)).toBe(issued.token);
      expect(issued.expiresAt).toBeInstanceOf(Date);
    });

    /** Rotating would void the token a second tab is already holding. */
    it('reuses an existing context', () => {
      const { response, jar } = recorder();
      service().issue(requestWith({ [CONTEXT_COOKIE]: 'anon:kept' }), response);

      expect(jar.get(CONTEXT_COOKIE)).toBe('anon:kept');
    });

    it('issues a fresh token for the reused context', () => {
      const { response, jar } = recorder();
      const subject = service();
      const first = subject.issue(requestWith({}), response);
      const second = subject.issue(
        requestWith({ [CONTEXT_COOKIE]: jar.get(CONTEXT_COOKIE) as string }),
        response,
      );

      expect(second.token).not.toBe(first.token);
    });
  });

  describe('rebinding at login', () => {
    it('replaces the context with the session and never expires it', () => {
      const { response, jar } = recorder();
      const issued = service().bindToSession(response, 'ses_01JABC');

      expect(issued.mode).toBe('SESSION');
      expect(jar.get(CONTEXT_COOKIE)).toBe('sid:ses_01JABC');
      expect(issued.expiresAt).toBeNull();
    });

    /** 🔴 The heart of ADR-0016. */
    it('leaves the pre-session token unusable', () => {
      const { response, jar } = recorder();
      const subject = service();
      const before = subject.issue(requestWith({}), response);

      subject.bindToSession(response, 'ses_01JABC');

      const replay = requestWith(
        {
          [CONTEXT_COOKIE]: jar.get(CONTEXT_COOKIE) as string,
          [TOKEN_COOKIE]: before.token,
        },
        before.token,
      );

      expect(subject.validate(replay)).toBe(false);
    });
  });

  describe('validate', () => {
    function bound(sessionId = 'ses_01JABC') {
      const { response, jar } = recorder();
      const subject = service();
      const issued = subject.bindToSession(response, sessionId);

      return { subject, issued, jar };
    }

    it('accepts a matching cookie, header and context', () => {
      const { subject, issued, jar } = bound();

      expect(
        subject.validate(
          requestWith(
            {
              [CONTEXT_COOKIE]: jar.get(CONTEXT_COOKIE) as string,
              [TOKEN_COOKIE]: issued.token,
            },
            issued.token,
          ),
        ),
      ).toBe(true);
    });

    it('refuses a missing header', () => {
      const { subject, issued, jar } = bound();

      expect(
        subject.validate(
          requestWith({
            [CONTEXT_COOKIE]: jar.get(CONTEXT_COOKIE) as string,
            [TOKEN_COOKIE]: issued.token,
          }),
        ),
      ).toBe(false);
    });

    it('refuses a missing context cookie', () => {
      const { subject, issued } = bound();

      expect(
        subject.validate(
          requestWith({ [TOKEN_COOKIE]: issued.token }, issued.token),
        ),
      ).toBe(false);
    });

    it('refuses a header that differs from the cookie', () => {
      const { subject, issued, jar } = bound();
      const other = service().bindToSession(recorder().response, 'ses_OTHER');

      expect(
        subject.validate(
          requestWith(
            {
              [CONTEXT_COOKIE]: jar.get(CONTEXT_COOKIE) as string,
              [TOKEN_COOKIE]: issued.token,
            },
            other.token,
          ),
        ),
      ).toBe(false);
    });

    it('refuses a token bound to another session', () => {
      const { subject, jar } = bound();
      const other = service().bindToSession(recorder().response, 'ses_OTHER');

      expect(
        subject.validate(
          requestWith(
            {
              [CONTEXT_COOKIE]: jar.get(CONTEXT_COOKIE) as string,
              [TOKEN_COOKIE]: other.token,
            },
            other.token,
          ),
        ),
      ).toBe(false);
    });
  });

  it('clears both cookies', () => {
    const { response, cleared } = recorder();
    service().clear(response);

    expect(cleared).toEqual([CONTEXT_COOKIE, TOKEN_COOKIE]);
  });
});
