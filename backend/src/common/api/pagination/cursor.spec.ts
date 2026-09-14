import { createHmac, randomBytes } from 'node:crypto';

import {
  MAX_CURSOR_LENGTH,
  paginationScope,
  signCursor,
  verifyCursor,
} from './cursor';

describe('pagination cursor', () => {
  const key = randomBytes(32);
  const scope = paginationScope({
    organizationId: 'org_a',
    sortBy: 'createdAt',
  });
  const payload = {
    scope,
    key: ['2026-09-13T10:00:00.000Z', 'par_01'] as const,
  };

  it('round-trips a cursor it signed', () => {
    expect(verifyCursor(signCursor(payload, key), key)).toEqual(payload);
  });

  it('refuses a cursor signed with another key', () => {
    const forged = signCursor(payload, randomBytes(32));

    expect(verifyCursor(forged, key)).toBeNull();
  });

  /**
   * The attack T-5 names: keep the signature, rewrite the keyset. The body
   * is only base64url, so rewriting it is trivial — which is exactly why the
   * signature covers it.
   */
  it('refuses a cursor whose payload was rewritten', () => {
    const [, signature] = signCursor(payload, key).split('.');
    const rewritten = Buffer.from(
      JSON.stringify({
        v: 1,
        s: scope,
        k: ['1970-01-01T00:00:00.000Z', 'par_00'],
      }),
    ).toString('base64url');

    expect(verifyCursor(`${rewritten}.${signature}`, key)).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['no separator', 'abcdef'],
    ['two separators', 'a.b.c'],
    ['leading separator', '.abc'],
    ['not base64url JSON', 'notjson.sig'],
    ['over the length cap', 'a'.repeat(MAX_CURSOR_LENGTH + 1)],
  ])('refuses a malformed cursor (%s) without throwing', (_label, token) => {
    expect(verifyCursor(token, key)).toBeNull();
  });

  it('refuses a correctly signed payload of the wrong shape', () => {
    const body = Buffer.from(
      JSON.stringify({ v: 1, s: scope, k: [42, 'par_01'] }),
    ).toString('base64url');
    const signature = createHmac('sha256', key)
      .update(body)
      .digest('base64url');

    expect(verifyCursor(`${body}.${signature}`, key)).toBeNull();
  });

  describe('paginationScope', () => {
    it('ignores key order, so equal queries share a scope', () => {
      expect(paginationScope({ a: 1, b: ['x'] })).toBe(
        paginationScope({ b: ['x'], a: 1 }),
      );
    });

    it('separates queries that differ in any part', () => {
      const base = {
        organizationId: 'org_a',
        sortBy: 'createdAt',
        search: null,
      };

      expect(paginationScope(base)).not.toBe(
        paginationScope({ ...base, organizationId: 'org_b' }),
      );
      expect(paginationScope(base)).not.toBe(
        paginationScope({ ...base, sortBy: 'lastName' }),
      );
      expect(paginationScope(base)).not.toBe(
        paginationScope({ ...base, search: 'dupont' }),
      );
    });
  });
});
