import { registerAs } from '@nestjs/config';

import type { Env } from './env.schema';

/**
 * CSRF settings (ADR-0016).
 *
 * Two binding modes: a pre-session token bound to an anonymous context cookie,
 * rebound to the real session on login. Without the pre-session mode the login
 * endpoint itself could not be protected, which is the contradiction ADR-0016
 * resolves.
 */
export const csrfConfig = registerAs('csrf', () => {
  const env = process.env as unknown as Env;

  return {
    secret: env.CSRF_SECRET,
    contextTtl: env.CSRF_CONTEXT_TTL,
    headerName: 'X-CSRF-Token',
    protectedMethods: ['POST', 'PUT', 'PATCH', 'DELETE'] as const,
    // Health and metrics only. Anything accepting an authentication cookie is
    // protected, without exception.
    exemptPaths: [
      '/health/live',
      '/health/ready',
      '/health/startup',
      '/metrics',
    ] as const,
  };
});
