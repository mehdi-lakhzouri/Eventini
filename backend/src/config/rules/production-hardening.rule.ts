import type { EnvironmentRule } from './rule.types';

/**
 * Rules 2 to 5 — settings that are acceptable locally and dangerous in
 * production.
 *
 * These catch a development configuration reaching a real environment, which is
 * the everyday shape of OWASP A05 Security Misconfiguration. Each one is a
 * refusal to start rather than a warning, because a warning in a deployment log
 * is a warning nobody reads.
 */
export const productionHardeningRule: EnvironmentRule = {
  id: '2-5',
  description: 'Production forbids development-grade settings',

  check(env) {
    const errors: string[] = [];
    const isProduction = env.NODE_ENV === 'production';

    // Rule 2 — cookies without Secure travel over plain HTTP, so the access and
    // refresh tokens are readable by anyone on the path.
    if (isProduction && !env.COOKIE_SECURE) {
      errors.push(
        'COOKIE_SECURE must be true when NODE_ENV=production (cookies would otherwise be sent over plain HTTP).',
      );
    }

    // Rule 3 — redaction off means passwords, tokens and cookies reach the log
    // store in clear text. PINO_LOGGING_SPECIFICATION.md §30 forbids it.
    //
    // Staging is included deliberately. §16 says of staging, without
    // qualification, "La redaction ne doit jamais être désactivée", and
    // staging routinely holds real invited users and real integration
    // credentials — a secret leaked to the staging log store is leaked. This
    // rule previously only covered production; `staging` is a valid NODE_ENV
    // in the schema, so that left a real environment uncovered.
    const redactionRequired = isProduction || env.NODE_ENV === 'staging';
    if (redactionRequired && !env.LOG_REDACTION_ENABLED) {
      errors.push(
        `LOG_REDACTION_ENABLED must be true when NODE_ENV=${env.NODE_ENV} (secrets would be written to logs in clear text).`,
      );
    }

    // Rule 4 — demo data creates predictable accounts in a real tenant.
    if (isProduction && env.SEED_DEMO_DATA) {
      errors.push(
        'SEED_DEMO_DATA must be false when NODE_ENV=production (demo fixtures would be inserted into real tenant data).',
      );
    }

    // Rule 5 — an http:// origin in production means credentials cross the
    // network unencrypted, and CORS with credentials makes that reachable from
    // a page the user did not intend to trust.
    if (isProduction) {
      const insecure = env.CORS_ALLOWED_ORIGINS.filter(
        (origin) => !origin.startsWith('https://'),
      );

      if (insecure.length > 0) {
        errors.push(
          `CORS_ALLOWED_ORIGINS must use https:// only when NODE_ENV=production. Offending: ${insecure.join(', ')}.`,
        );
      }

      // Transactional-email CTAs are derived from this origin. Allowing HTTP
      // here would put single-use verification/reset tokens on a clear-text
      // connection even while the API itself is correctly hardened.
      if (!env.WEB_BASE_URL.startsWith('https://')) {
        errors.push(
          'WEB_BASE_URL must use https:// when NODE_ENV=production (transactional email action links carry sensitive tokens).',
        );
      }
    }

    // Not numbered in §17, but the same class of mistake: a wildcard origin
    // combined with credentials is rejected by browsers anyway, and writing it
    // signals a misunderstanding worth stopping at the door.
    if (env.CORS_ALLOWED_ORIGINS.includes('*')) {
      errors.push(
        'CORS_ALLOWED_ORIGINS must list exact origins; "*" is never valid with credentials.',
      );
    }

    return errors;
  },
};
