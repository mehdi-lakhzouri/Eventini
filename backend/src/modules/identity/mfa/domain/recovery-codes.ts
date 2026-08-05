import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Crockford base32 without `I`, `L`, `O` and `U` — §4.8.
 *
 * The first three are dropped because they are unreadable against 1 and 0 on
 * a printed sheet, which is where these codes live. `U` is dropped so the
 * alphabet cannot spell an obscenity by accident.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 10;

export function generateRecoveryCode(): string {
  let code = '';

  for (let index = 0; index < CODE_LENGTH; index += 1) {
    // randomInt, not Math.random: these are credentials.
    code += ALPHABET[randomInt(ALPHABET.length)];
  }

  return code;
}

export function generateRecoveryCodes(count: number): string[] {
  const codes = new Set<string>();

  while (codes.size < count) {
    codes.add(generateRecoveryCode());
  }

  return [...codes];
}

/**
 * SHA-256, unkeyed — unlike the refresh and reset tokens. A recovery code is
 * looked up by its hash across the whole table, so the digest has to be
 * reproducible from the code alone.
 */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

/** Users retype these from paper: case and separators are forgiven. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replaceAll(/[\s-]/g, '');
}

export function recoveryCodeMatches(
  code: string,
  expectedHash: string,
): boolean {
  const actual = Buffer.from(hashRecoveryCode(code), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
