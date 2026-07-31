import {
  DEFAULT_CODE_BY_STATUS,
  ERROR_CATALOG,
  errorTypeUri,
} from './error-codes';

describe('ERROR_CATALOG', () => {
  const entries = Object.entries(ERROR_CATALOG);

  it('gives every code a valid HTTP status', () => {
    for (const [code, entry] of entries) {
      expect(entry.status).toBeGreaterThanOrEqual(400);
      expect(entry.status).toBeLessThan(600);
      expect(Number.isInteger(entry.status)).toBe(true);
      expect(entry.status).not.toBeNaN();
      void code;
    }
  });

  it('gives every code a non-empty title and a kebab-case slug', () => {
    for (const [code, entry] of entries) {
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      void code;
    }
  });

  it('never maps AUTH_ACCOUNT_LOCKED to a client-facing code', () => {
    expect('AUTH_ACCOUNT_LOCKED' in ERROR_CATALOG).toBe(false);
  });

  it('builds a stable type URI from the slug', () => {
    expect(errorTypeUri('VALIDATION_ERROR')).toBe(
      'https://errors.eventini.com/validation-error',
    );
  });

  it('only points DEFAULT_CODE_BY_STATUS at codes that exist in the catalogue', () => {
    for (const code of Object.values(DEFAULT_CODE_BY_STATUS)) {
      expect(code && code in ERROR_CATALOG).toBe(true);
    }
  });

  it('agrees with the status DEFAULT_CODE_BY_STATUS is keyed by', () => {
    for (const [status, code] of Object.entries(DEFAULT_CODE_BY_STATUS)) {
      if (!code) continue;
      expect(ERROR_CATALOG[code].status).toBe(Number(status));
    }
  });
});
