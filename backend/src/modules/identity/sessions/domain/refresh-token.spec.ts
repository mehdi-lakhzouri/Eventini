import { randomBytes } from 'node:crypto';

import {
  hashRefreshToken,
  issueRefreshToken,
  refreshTokenMatches,
} from './refresh-token';

const SECRET = randomBytes(32).toString('base64');

describe('issueRefreshToken', () => {
  it('produces 32 bytes of entropy, base64url encoded', () => {
    const { token } = issueRefreshToken(SECRET);

    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('never repeats', () => {
    const tokens = new Set(
      Array.from({ length: 1000 }, () => issueRefreshToken(SECRET).token),
    );

    expect(tokens.size).toBe(1000);
  });

  it('stores the hash, not the token', () => {
    const { token, tokenHash } = issueRefreshToken(SECRET);

    expect(tokenHash).not.toContain(token);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hashRefreshToken', () => {
  it('is deterministic for the same secret', () => {
    const { token } = issueRefreshToken(SECRET);

    expect(hashRefreshToken(token, SECRET)).toBe(
      hashRefreshToken(token, SECRET),
    );
  });

  /** A leaked database is useless without the secret held outside it. */
  it('changes completely with the secret', () => {
    const { token } = issueRefreshToken(SECRET);
    const other = randomBytes(32).toString('base64');

    expect(hashRefreshToken(token, other)).not.toBe(
      hashRefreshToken(token, SECRET),
    );
  });
});

describe('refreshTokenMatches', () => {
  it('accepts the token it hashed', () => {
    const { token, tokenHash } = issueRefreshToken(SECRET);

    expect(refreshTokenMatches(token, tokenHash, SECRET)).toBe(true);
  });

  it.each([
    ['a different token', () => issueRefreshToken(SECRET).token],
    ['an empty token', () => ''],
    ['a truncated token', () => issueRefreshToken(SECRET).token.slice(0, 20)],
  ])('rejects %s', (_label, make) => {
    const { tokenHash } = issueRefreshToken(SECRET);

    expect(refreshTokenMatches(make(), tokenHash, SECRET)).toBe(false);
  });

  it('rejects the right token under the wrong secret', () => {
    const { token, tokenHash } = issueRefreshToken(SECRET);

    expect(
      refreshTokenMatches(token, tokenHash, randomBytes(32).toString('base64')),
    ).toBe(false);
  });

  /** `timingSafeEqual` throws on a length mismatch, so it is checked first. */
  it('does not throw on a malformed stored hash', () => {
    const { token } = issueRefreshToken(SECRET);

    expect(refreshTokenMatches(token, 'abc', SECRET)).toBe(false);
    expect(refreshTokenMatches(token, '', SECRET)).toBe(false);
  });
});
