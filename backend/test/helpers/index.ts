import type { INestApplication } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import request from 'supertest';

import { applicationConfig } from '../../src/config/application.config';
import { cookiesConfig } from '../../src/config/cookies.config';

/**
 * Everything a mutating request needs to get past `CsrfGuard` (EVT-028).
 *
 * The guard is global, so every `POST`/`PUT`/`PATCH`/`DELETE` in the e2e
 * suites carries one of these. Building it from the server's own `Set-Cookie`
 * headers is deliberate: a test that hand-rolled a token would keep passing
 * after the binding stopped working.
 */
export interface Csrf {
  readonly token: string;
  /** Merges the CSRF pair with any session cookies the caller already holds. */
  headers(extraCookies?: string): Record<string, string>;
}

/** The pre-session handshake: `GET /auth/csrf-token` with nothing in hand. */
export async function preSessionCsrf(app: INestApplication): Promise<Csrf> {
  const response = await request(app.getHttpServer()).get(
    '/api/v1/auth/csrf-token',
  );

  return csrfOf(app, response);
}

/**
 * The pair carried by any response that issued one — in practice the login
 * and MFA verification responses, which rebind the token to the new session.
 */
export function csrfOf(app: INestApplication, response: request.Response): Csrf {
  const cookies = app.get<ConfigType<typeof cookiesConfig>>(cookiesConfig.KEY);
  const origin = app.get<ConfigType<typeof applicationConfig>>(
    applicationConfig.KEY,
  ).corsAllowedOrigins[0] as string;

  const context = cookieValue(response, cookies.csrfContext.name);
  const token = cookieValue(response, cookies.csrf.name);

  if (context === undefined || token === undefined) {
    throw new Error('The response carried no CSRF cookies.');
  }

  const pair = `${cookies.csrfContext.name}=${context}; ${cookies.csrf.name}=${token}`;

  return {
    token,
    headers: (extraCookies?: string) => ({
      Origin: origin,
      'X-CSRF-Token': token,
      Cookie: extraCookies === undefined ? pair : `${pair}; ${extraCookies}`,
    }),
  };
}

export function cookieValue(
  response: request.Response,
  name: string,
): string | undefined {
  const cookies = (response.headers['set-cookie'] ?? []) as unknown as string[];

  return cookies
    .map((cookie) => {
      const [pair] = cookie.split(';');

      return pair?.startsWith(`${name}=`)
        ? pair.slice(name.length + 1)
        : undefined;
    })
    .find((value): value is string => value !== undefined);
}
