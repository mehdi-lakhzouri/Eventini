import pino from 'pino';

import {
  REDACTION_PATHS,
  SENSITIVE_KEYS,
  scrubSensitiveKeys,
} from './log-redaction.config';
import { MAX_SCRUB_DEPTH, REDACTED_PLACEHOLDER } from './logging.constants';

describe('scrubSensitiveKeys', () => {
  it('redacts a sensitive key at the root', () => {
    expect(scrubSensitiveKeys({ password: 'hunter2' })).toEqual({
      password: REDACTED_PLACEHOLDER,
    });
  });

  it('redacts a sensitive key nested arbitrarily deep', () => {
    const scrubbed = scrubSensitiveKeys({
      a: { b: { c: { d: { refreshToken: 'rt_secret' } } } },
    });

    expect(JSON.stringify(scrubbed)).not.toContain('rt_secret');
  });

  it('redacts inside arrays', () => {
    const scrubbed = scrubSensitiveKeys({
      users: [{ email: 'a@b.c', password: 'p1' }, { password: 'p2' }],
    });

    expect(JSON.stringify(scrubbed)).not.toContain('p1');
    expect(JSON.stringify(scrubbed)).not.toContain('p2');
    // Non-sensitive siblings survive — redaction that eats everything is
    // indistinguishable from having no logs.
    expect(JSON.stringify(scrubbed)).toContain('a@b.c');
  });

  it('matches key names case-insensitively', () => {
    const scrubbed = scrubSensitiveKeys({
      Authorization: 'Bearer abc',
      PASSWORD: 'x',
    }) as Record<string, unknown>;

    expect(scrubbed.Authorization).toBe(REDACTED_PLACEHOLDER);
    expect(scrubbed.PASSWORD).toBe(REDACTED_PLACEHOLDER);
  });

  it('leaves non-sensitive values untouched', () => {
    const input = { userId: 'usr_1', count: 3, active: true, tags: ['a'] };
    expect(scrubSensitiveKeys(input)).toEqual(input);
  });

  it('terminates on a cyclic object instead of hanging', () => {
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic.self = cyclic;

    expect(() => scrubSensitiveKeys(cyclic)).not.toThrow();
  });

  it('stops at the depth bound', () => {
    let deep: Record<string, unknown> = { password: 'below-the-bound' };
    for (let i = 0; i < MAX_SCRUB_DEPTH + 2; i += 1) {
      deep = { nested: deep };
    }

    // Documents the limit honestly rather than pretending it is unbounded:
    // past MAX_SCRUB_DEPTH the walker stops, which is why the Pino `redact`
    // paths and the "never pass the secret to the logger" rule both still
    // matter.
    expect(() => scrubSensitiveKeys(deep)).not.toThrow();
  });

  it('does not rewrite Date or Buffer instances into plain objects', () => {
    const date = new Date('2026-07-31T00:00:00.000Z');
    const scrubbed = scrubSensitiveKeys({ when: date }) as {
      when: unknown;
    };

    expect(scrubbed.when).toBe(date);
  });
});

describe('REDACTION_PATHS', () => {
  it('covers both the root and one nested level for every sensitive key', () => {
    for (const key of SENSITIVE_KEYS) {
      expect(REDACTION_PATHS).toContain(key);
      expect(REDACTION_PATHS).toContain(`*.${key}`);
    }
  });

  it('is accepted by Pino (paths are syntax-checked at logger construction)', () => {
    expect(() =>
      pino(
        { redact: { paths: [...REDACTION_PATHS] } },
        pino.destination({ sync: true }),
      ),
    ).not.toThrow();
  });
});

/**
 * PINO_LOGGING_SPECIFICATION.md §39.2 — inject a known value into each named
 * field and assert it never reaches the output. This is the test the whole
 * redaction layer exists to pass, so it runs against a real Pino logger
 * configured exactly as the application configures one, not against the
 * scrubber in isolation.
 */
describe('redaction end to end (§39.2)', () => {
  const CANARY = 'CANARY_SECRET_VALUE_9f3a';

  function captureLog(payload: object): string {
    const lines: string[] = [];
    const logger = pino(
      {
        redact: { paths: [...REDACTION_PATHS], censor: REDACTED_PLACEHOLDER },
        formatters: {
          log: (object: Record<string, unknown>) =>
            scrubSensitiveKeys(object) as Record<string, unknown>,
        },
      },
      { write: (line: string) => lines.push(line) },
    );

    logger.info(payload, 'test');
    return lines.join('');
  }

  it.each([
    ['Authorization header', { req: { headers: { authorization: CANARY } } }],
    ['Cookie header', { req: { headers: { cookie: CANARY } } }],
    ['password', { password: CANARY }],
    ['nested password', { body: { password: CANARY } }],
    ['refreshToken', { refreshToken: CANARY }],
    ['nested refreshToken', { session: { refreshToken: CANARY } }],
    ['csrfToken', { csrfToken: CANARY }],
    ['mfaSecret', { mfaSecret: CANARY }],
    ['privateKey', { privateKey: CANARY }],
    ['deeply nested token', { a: { b: { c: { token: CANARY } } } }],
  ])('never emits %s', (_label, payload) => {
    expect(captureLog(payload)).not.toContain(CANARY);
  });
});
