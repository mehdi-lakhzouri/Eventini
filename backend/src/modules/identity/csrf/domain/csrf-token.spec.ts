import {
  csrfTokenMatches,
  equalsInConstantTime,
  issueCsrfToken,
} from './csrf-token';

const SECRET = 'a-secret-that-only-the-server-knows';

describe('csrf token', () => {
  it('verifies against the binding it was issued for', () => {
    const token = issueCsrfToken(SECRET, 'anon:context-one');

    expect(csrfTokenMatches(SECRET, 'anon:context-one', token)).toBe(true);
  });

  /** The whole point of signing over the binding. */
  it('refuses a token issued for another binding', () => {
    const token = issueCsrfToken(SECRET, 'anon:context-one');

    expect(csrfTokenMatches(SECRET, 'anon:context-two', token)).toBe(false);
  });

  it('refuses a pre-session token once the binding names a session', () => {
    const token = issueCsrfToken(SECRET, 'anon:anonymous');

    expect(csrfTokenMatches(SECRET, 'sid:ses_01JABC', token)).toBe(false);
  });

  it('refuses a token signed with another secret', () => {
    const token = issueCsrfToken('another-secret-entirely-different', 'anon:ctx');

    expect(csrfTokenMatches(SECRET, 'anon:ctx', token)).toBe(false);
  });

  it('never issues the same token twice for one binding', () => {
    expect(issueCsrfToken(SECRET, 'anon:ctx')).not.toBe(
      issueCsrfToken(SECRET, 'anon:ctx'),
    );
  });

  it.each([
    ['empty', ''],
    ['unstructured', 'not-a-token'],
    ['signature only', 'nonce'],
    ['too many parts', 'a.b.c'],
    ['empty signature', 'nonce.'],
  ])('refuses a %s token', (_label, token) => {
    expect(csrfTokenMatches(SECRET, 'anon:ctx', token)).toBe(false);
  });

  /**
   * A tampered signature must not throw either — `timingSafeEqual` rejects
   * operands of different lengths by raising, which would surface as a 500
   * instead of the 403 the specification requires.
   */
  it('refuses a truncated signature without throwing', () => {
    const token = issueCsrfToken(SECRET, 'anon:ctx');

    expect(csrfTokenMatches(SECRET, 'anon:ctx', token.slice(0, -4))).toBe(false);
  });

  /**
   * `binding` and `nonce` are length-prefixed before hashing, so a pair that
   * re-splits into another cannot produce the same signature.
   */
  it('does not confuse bindings that concatenate identically', () => {
    const token = issueCsrfToken(SECRET, 'ab');
    const [nonce] = token.split('.');

    expect(csrfTokenMatches(SECRET, 'a', `b${nonce ?? ''}.x`)).toBe(false);
  });
});

describe('equalsInConstantTime', () => {
  it.each([
    ['equal values', 'abcdef', 'abcdef', true],
    ['different values', 'abcdef', 'abcdeg', false],
    ['different lengths', 'abcdef', 'abcde', false],
    ['both empty', '', '', true],
  ])('%s', (_label, left, right, expected) => {
    expect(equalsInConstantTime(left, right)).toBe(expected);
  });
});
