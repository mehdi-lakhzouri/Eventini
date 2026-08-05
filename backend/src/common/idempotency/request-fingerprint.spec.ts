import {
  requestFingerprint,
  type FingerprintInput,
} from './request-fingerprint';

const base: FingerprintInput = {
  method: 'POST',
  routeTemplate: '/api/v1/events/:eventId/check-ins',
  organizationId: 'org_01',
  actorId: 'usr_01',
  body: { ticketReference: 'tkt_pub_a1', eventSessionId: 'esn_01' },
  pathParams: { eventId: 'evt_01' },
};

function hash(overrides: Partial<FingerprintInput> = {}): string {
  return requestFingerprint({ ...base, ...overrides });
}

describe('requestFingerprint', () => {
  it('is a SHA-256 hex digest', () => {
    expect(hash()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores the order of body keys', () => {
    expect(
      hash({
        body: { eventSessionId: 'esn_01', ticketReference: 'tkt_pub_a1' },
      }),
    ).toBe(hash());
  });

  it('ignores the order of path parameters', () => {
    const one = hash({ pathParams: { a: '1', b: '2' } });
    const other = hash({ pathParams: { b: '2', a: '1' } });

    expect(one).toBe(other);
  });

  it('is case-insensitive on the method only', () => {
    expect(hash({ method: 'post' })).toBe(hash());
  });

  /**
   * Each of these is a different request that happens to share a key, and the
   * fingerprint is the only thing that can say so — the unique index cannot,
   * because it is what said the key was taken.
   */
  it.each<[string, Partial<FingerprintInput>]>([
    ['a different body', { body: { ticketReference: 'tkt_pub_b2' } }],
    ['a different tenant', { organizationId: 'org_02' }],
    ['a different actor', { actorId: 'usr_02' }],
    [
      'a different route',
      { routeTemplate: '/api/v1/events/:eventId/check-outs' },
    ],
    ['a different method', { method: 'DELETE' }],
    ['a different path parameter', { pathParams: { eventId: 'evt_02' } }],
  ])('changes for %s', (_label, overrides) => {
    expect(hash(overrides)).not.toBe(hash());
  });

  /**
   * The platform case: `organizationId` is null rather than absent, and an
   * empty string is what stands in for it. Pinned so that a tenant literally
   * called "" — impossible, but the reasoning should not rest on that — is not
   * the thing keeping these apart.
   */
  it('separates a platform request from a tenant one', () => {
    expect(hash({ organizationId: null })).not.toBe(hash());
  });

  /**
   * Test 8 of §13. Headers are not a parameter of this function at all, which
   * is the strongest form the exclusion can take: there is nothing to forget
   * to strip. The e2e suite proves it end to end over a real `traceparent`.
   */
  it('takes no headers', () => {
    expect(Object.keys(base)).toEqual([
      'method',
      'routeTemplate',
      'organizationId',
      'actorId',
      'body',
      'pathParams',
    ]);
  });
});
