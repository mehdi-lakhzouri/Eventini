import {
  PasswordPolicyError,
  assertPasswordAllowed,
  normalizePassword,
} from './password.policy';

const LIMITS = { minLength: 12, maxLength: 128 };

describe('normalizePassword', () => {
  it('applies NFKC', () => {
    expect(normalizePassword('ﬁreﬂy')).toBe('firefly');
  });

  it('keeps leading and trailing whitespace', () => {
    expect(normalizePassword('  spaces matter  ')).toBe('  spaces matter  ');
  });

  it('is idempotent', () => {
    const once = normalizePassword('Ⅻ  passphrase');

    expect(normalizePassword(once)).toBe(once);
  });
});

describe('assertPasswordAllowed', () => {
  it('returns the normalized password', () => {
    expect(assertPasswordAllowed('ﬁreﬂy in the night', LIMITS)).toBe(
      'firefly in the night',
    );
  });

  it('accepts exactly the minimum length', () => {
    expect(() => assertPasswordAllowed('a'.repeat(12), LIMITS)).not.toThrow();
  });

  it('accepts exactly the maximum length', () => {
    expect(() => assertPasswordAllowed('a'.repeat(128), LIMITS)).not.toThrow();
  });

  it.each([
    ['one below the minimum', 'a'.repeat(11), 'TOO_SHORT'],
    ['empty', '', 'TOO_SHORT'],
    ['one above the maximum', 'a'.repeat(129), 'TOO_LONG'],
  ])('rejects %s', (_label, password, violation) => {
    expect(() => assertPasswordAllowed(password, LIMITS)).toThrow(
      PasswordPolicyError,
    );
    try {
      assertPasswordAllowed(password, LIMITS);
    } catch (error) {
      expect((error as PasswordPolicyError).violation).toBe(violation);
    }
  });

  it('enforces no composition rules', () => {
    expect(() =>
      assertPasswordAllowed('aaaaaaaaaaaaaaaa', LIMITS),
    ).not.toThrow();
  });

  it('measures length after normalization', () => {
    // 12 ligatures normalize to 24 characters; 6 would be 12.
    expect(() => assertPasswordAllowed('ﬁ'.repeat(6), LIMITS)).not.toThrow();
    expect(() => assertPasswordAllowed('ﬁ'.repeat(5), LIMITS)).toThrow(
      PasswordPolicyError,
    );
  });

  it('counts code points, not UTF-16 units', () => {
    // 12 emoji are 24 UTF-16 units; counting units would let 6 through.
    expect(() => assertPasswordAllowed('🔒'.repeat(6), LIMITS)).toThrow(
      PasswordPolicyError,
    );
    expect(() => assertPasswordAllowed('🔒'.repeat(12), LIMITS)).not.toThrow();
    expect(() => assertPasswordAllowed('🔒'.repeat(129), LIMITS)).toThrow(
      PasswordPolicyError,
    );
  });
});
