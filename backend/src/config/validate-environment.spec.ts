import { buildValidEnv } from './__fixtures__/valid-env.fixture';
import {
  EnvironmentValidationError,
  validateEnvironment,
} from './validate-environment';
import { EXAMPLE_SECRET_MARKER } from './parsers/secret.parser';

/** Collects the failure messages, or fails the test if validation passed. */
function problemsFor(env: Record<string, unknown>): readonly string[] {
  try {
    validateEnvironment(env);
  } catch (error) {
    if (error instanceof EnvironmentValidationError) {
      return error.problems;
    }
    throw error;
  }

  throw new Error('Expected validation to fail, but it passed.');
}

describe('validateEnvironment', () => {
  it('accepts a complete, coherent environment', () => {
    expect(() => validateEnvironment(buildValidEnv())).not.toThrow();
  });

  it('applies documented defaults so only genuinely required values are mandatory', () => {
    const env = validateEnvironment(buildValidEnv());

    expect(env.PORT).toBe(3001);
    expect(env.ARGON2_MEMORY_COST).toBe(19_456);
    expect(env.PAGINATION_DEFAULT_LIMIT).toBe(20);
    expect(env.PAGINATION_MAX_LIMIT).toBe(100);
    expect(env.COOKIE_ACCESS_NAME).toBe('__Host-eventini_access');
    expect(env.COOKIE_REFRESH_PATH).toBe('/api/v1/auth/sessions');
  });

  it('parses durations into milliseconds', () => {
    const env = validateEnvironment(buildValidEnv());

    expect(env.ACCESS_TOKEN_TTL_WEB_ADMIN).toBe(600_000);
    expect(env.REFRESH_TOKEN_TTL_WEB_ADMIN).toBe(1_209_600_000);
    // 7 days, not 24 hours: a scanner can be offline for a whole multi-day
    // event, and a shorter window turns a legitimate replay into a duplicate
    // check-in (ADR-0012).
    expect(env.IDEMPOTENCY_RETENTION_ATTENDANCE).toBe(604_800_000);
  });
});

describe('rule 1 — every missing variable is reported at once', () => {
  it('does not stop at the first failure', () => {
    const problems = problemsFor({});

    // Configuring a deployment one restart at a time is the experience §17
    // explicitly rules out.
    expect(problems.length).toBeGreaterThan(10);
  });

  it('names each missing variable', () => {
    const problems = problemsFor({}).join('\n');

    expect(problems).toContain('DATABASE_URL');
    expect(problems).toContain('REDIS_URL');
    expect(problems).toContain('ACCESS_TOKEN_PRIVATE_KEY');
    expect(problems).toContain('SMTP_HOST');
  });
});

describe('rules 2-5 — production hardening', () => {
  const production = (overrides: Record<string, unknown>) =>
    problemsFor(
      buildValidEnv({
        NODE_ENV: 'production',
        COOKIE_SECURE: 'true',
        CORS_ALLOWED_ORIGINS: 'https://app.eventini.com',
        WEB_BASE_URL: 'https://app.eventini.com',
        ...overrides,
      }),
    ).join('\n');

  it('rejects COOKIE_SECURE=false in production', () => {
    expect(production({ COOKIE_SECURE: 'false' })).toContain('COOKIE_SECURE');
  });

  it('rejects log redaction disabled in production', () => {
    expect(production({ LOG_REDACTION_ENABLED: 'false' })).toContain(
      'LOG_REDACTION_ENABLED',
    );
  });

  it('rejects demo seed data in production', () => {
    expect(production({ SEED_DEMO_DATA: 'true' })).toContain('SEED_DEMO_DATA');
  });

  it('rejects a plain http origin in production', () => {
    expect(
      production({ CORS_ALLOWED_ORIGINS: 'http://app.eventini.com' }),
    ).toContain('https://');
  });

  it('rejects plain HTTP links in production emails', () => {
    expect(production({ WEB_BASE_URL: 'http://app.eventini.com' })).toContain(
      'WEB_BASE_URL',
    );
  });

  it('rejects a wildcard origin in any environment', () => {
    expect(
      problemsFor(buildValidEnv({ CORS_ALLOWED_ORIGINS: '*' })).join('\n'),
    ).toContain('exact origins');
  });

  /**
   * `COOKIE_SECURE=false` reste permis hors production — mais **seulement**
   * avec des noms de cookies non préfixés, sans quoi le navigateur jette tout
   * (voir la règle 15). Le couplage est réel : les deux vont ensemble ou ne
   * vont pas, et le test le dit désormais au lieu de tester la moitié.
   */
  it('allows the same development settings outside production', () => {
    expect(() =>
      validateEnvironment(
        buildValidEnv({
          NODE_ENV: 'development',
          COOKIE_SECURE: 'false',
          COOKIE_ACCESS_NAME: 'eventini_access',
          COOKIE_REFRESH_NAME: 'eventini_refresh',
          COOKIE_CSRF_NAME: 'eventini_csrf',
          COOKIE_CSRF_CONTEXT_NAME: 'eventini_csrf_ctx',
        }),
      ),
    ).not.toThrow();
  });
});

/**
 * Règle 15 — un cookie préfixé exige `Secure`.
 *
 * 🔴 Le défaut qu'elle ferme est celui qu'a livré `.env.example` : quatre noms
 * `__Host-` / `__Secure-` avec `COOKIE_SECURE=false`. Le navigateur **jette**
 * un tel cookie, donc `/auth/csrf-token` répondait `200` sans qu'aucun cookie
 * ne soit stocké, et toute connexion locale échouait en `AUTH_CSRF_INVALID`
 * avec des identifiants valides.
 */
describe('rule 15 — prefixed cookies require Secure', () => {
  it('refuses __Host- names when COOKIE_SECURE is false', () => {
    const problems = problemsFor(
      buildValidEnv({ NODE_ENV: 'development', COOKIE_SECURE: 'false' }),
    ).join('\n');

    expect(problems).toContain('COOKIE_SECURE=false is incompatible');
    expect(problems).toContain('AUTH_CSRF_INVALID');
  });

  it('names every offending variable, not just the first', () => {
    const problems = problemsFor(
      buildValidEnv({ NODE_ENV: 'development', COOKIE_SECURE: 'false' }),
    ).join('\n');

    for (const key of [
      'COOKIE_ACCESS_NAME',
      'COOKIE_REFRESH_NAME',
      'COOKIE_CSRF_NAME',
      'COOKIE_CSRF_CONTEXT_NAME',
    ]) {
      expect(problems).toContain(key);
    }
  });

  it('catches __Secure- as well as __Host-', () => {
    const problems = problemsFor(
      buildValidEnv({
        NODE_ENV: 'development',
        COOKIE_SECURE: 'false',
        COOKIE_ACCESS_NAME: 'eventini_access',
        COOKIE_CSRF_NAME: 'eventini_csrf',
        COOKIE_CSRF_CONTEXT_NAME: 'eventini_csrf_ctx',
        // Seul le refresh garde son préfixe.
        COOKIE_REFRESH_NAME: '__Secure-eventini_refresh',
      }),
    ).join('\n');

    expect(problems).toContain('COOKIE_REFRESH_NAME');
    expect(problems).not.toContain('COOKIE_ACCESS_NAME');
  });

  /*
    `problemsFor` exige que la validation échoue — c'est le mauvais outil pour
    un cas qui doit passer. Ces deux-là valident tout court.
  */
  it('accepts prefixed names when COOKIE_SECURE is true', () => {
    expect(() =>
      validateEnvironment(buildValidEnv({ COOKIE_SECURE: 'true' })),
    ).not.toThrow();
  });

  it('accepts COOKIE_SECURE=false when no name carries a prefix', () => {
    expect(() =>
      validateEnvironment(
        buildValidEnv({
          NODE_ENV: 'development',
          COOKIE_SECURE: 'false',
          COOKIE_ACCESS_NAME: 'eventini_access',
          COOKIE_REFRESH_NAME: 'eventini_refresh',
          COOKIE_CSRF_NAME: 'eventini_csrf',
          COOKIE_CSRF_CONTEXT_NAME: 'eventini_csrf_ctx',
        }),
      ),
    ).not.toThrow();
  });
});

describe('rule 7 — secret entropy', () => {
  it('rejects a secret shorter than 32 decoded bytes', () => {
    const problems = problemsFor(
      buildValidEnv({
        CSRF_SECRET: Buffer.from('too-short').toString('base64'),
      }),
    ).join('\n');

    expect(problems).toContain('CSRF_SECRET');
    expect(problems).toContain('32 bytes');
  });

  it('suggests how to generate a correct one', () => {
    const problems = problemsFor(
      buildValidEnv({
        PASSWORD_PEPPER: Buffer.from('short').toString('base64'),
      }),
    ).join('\n');

    expect(problems).toContain('openssl rand -base64 32');
  });
});

describe('rule 8 — secret reuse', () => {
  // Key separation is the point of having seven secrets; a copy-paste undoes it
  // silently, and nothing else in the system would ever notice.
  it('rejects two secrets holding the same value', () => {
    const base = buildValidEnv();
    const problems = problemsFor({
      ...base,
      CSRF_SECRET: base.COOKIE_SECRET,
    }).join('\n');

    expect(problems).toContain('identical');
    expect(problems).toContain('key separation');
  });

  it('accepts secrets that merely look similar', () => {
    expect(() => validateEnvironment(buildValidEnv())).not.toThrow();
  });
});

describe('rule 9 — example placeholders', () => {
  const placeholder = Buffer.from(
    `${EXAMPLE_SECRET_MARKER}-REPLACE-BEFORE-ANY-DEPLOYMENT`,
  ).toString('base64');

  it('rejects a placeholder copied from .env.example', () => {
    const problems = problemsFor(
      buildValidEnv({ CSRF_SECRET: placeholder }),
    ).join('\n');

    expect(problems).toContain('placeholder from .env.example');
  });

  // The placeholder is deliberately long enough to satisfy rule 7, so that
  // "you shipped the example file" is what gets reported rather than a
  // misleading complaint about entropy.
  it('reports it as a placeholder, not as insufficient entropy', () => {
    const problems = problemsFor(
      buildValidEnv({ CSRF_SECRET: placeholder }),
    ).filter((problem) => problem.includes('CSRF_SECRET'));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('placeholder');
  });
});

describe('rule 10 — key pair correspondence', () => {
  // The nastiest failure in the list: the service starts, signs tokens happily,
  // then rejects every one of them. Every user is locked out with a generic 401
  // and nothing in the logs points at the keys.
  it('rejects a public key that does not match its private key', () => {
    const base = buildValidEnv();
    const problems = problemsFor({
      ...base,
      ACCESS_TOKEN_PUBLIC_KEY: base.QR_SIGNING_PUBLIC_KEY,
    }).join('\n');

    expect(problems).toContain('does not match');
    expect(problems).toContain('locking out every user');
  });

  it('rejects key material that is not Ed25519', () => {
    const problems = problemsFor(
      buildValidEnv({
        ACCESS_TOKEN_PRIVATE_KEY: Buffer.from('not-a-key').toString('base64'),
      }),
    ).join('\n');

    expect(problems).toContain('ACCESS_TOKEN_PRIVATE_KEY');
  });

  it('accepts genuinely matching pairs', () => {
    expect(() => validateEnvironment(buildValidEnv())).not.toThrow();
  });
});

describe('rules 11-14 — coherence', () => {
  it('rejects a default page size above the maximum', () => {
    expect(
      problemsFor(
        buildValidEnv({
          PAGINATION_DEFAULT_LIMIT: '500',
          PAGINATION_MAX_LIMIT: '100',
        }),
      ).join('\n'),
    ).toContain('PAGINATION_DEFAULT_LIMIT');
  });

  it('rejects an idle timeout longer than the absolute one', () => {
    const problems = problemsFor(
      buildValidEnv({ SESSION_IDLE_TTL_WEB_ADMIN: '60d' }),
    ).join('\n');

    expect(problems).toContain('idle timeout can never fire');
  });

  it('rejects a lockout ladder whose lists differ in length', () => {
    expect(
      problemsFor(
        buildValidEnv({
          LOCKOUT_THRESHOLDS: '5,10,15',
          LOCKOUT_DURATIONS: '15m,1h',
        }),
      ).join('\n'),
    ).toContain('each threshold needs exactly one duration');
  });

  it('rejects a lockout ladder that does not increase', () => {
    expect(
      problemsFor(
        buildValidEnv({
          LOCKOUT_THRESHOLDS: '10,5,15',
          LOCKOUT_DURATIONS: '15m,1h,24h',
        }),
      ).join('\n'),
    ).toContain('increase strictly');
  });

  it('rejects an Argon2 memory cost below the OWASP floor', () => {
    const problems = problemsFor(
      buildValidEnv({ ARGON2_MEMORY_COST: '4096' }),
    ).join('\n');

    expect(problems).toContain('19456');
    expect(problems).toContain('OWASP');
  });

  it('rejects an access token that outlives its refresh token', () => {
    expect(
      problemsFor(
        buildValidEnv({
          ACCESS_TOKEN_TTL_WEB_ADMIN: '30d',
          REFRESH_TOKEN_TTL_WEB_ADMIN: '14d',
        }),
      ).join('\n'),
    ).toContain('rotation can never happen');
  });

  // trust proxy as a boolean lets anyone forge X-Forwarded-For and bypass every
  // IP-based rate limit and the whole lockout ladder.
  it('rejects a non-numeric proxy hop count', () => {
    expect(
      problemsFor(buildValidEnv({ TRUSTED_PROXY_HOPS: 'true' })).join('\n'),
    ).toContain('TRUSTED_PROXY_HOPS');
  });
});

describe('error message', () => {
  it('points at the documentation and the generator', () => {
    try {
      validateEnvironment({});
      throw new Error('expected a failure');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentValidationError);
      const message = (error as EnvironmentValidationError).message;

      expect(message).toContain('will not start');
      expect(message).toContain('ENVIRONMENT_VARIABLES.md');
      expect(message).toContain('generate-dev-env.mjs');
    }
  });
});
