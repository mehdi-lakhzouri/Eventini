export type PasswordViolation = 'TOO_SHORT' | 'TOO_LONG';

export class PasswordPolicyError extends Error {
  constructor(readonly violation: PasswordViolation) {
    super(`Password rejected: ${violation}`);
    this.name = 'PasswordPolicyError';
  }
}

export interface PasswordLimits {
  readonly minLength: number;
  readonly maxLength: number;
}

/** NFKC only. Whitespace is significant and never trimmed (ADR-0007). */
export function normalizePassword(raw: string): string {
  return raw.normalize('NFKC');
}

/** Returns the normalized password, or throws. No composition rules (ASVS V2.1.9). */
export function assertPasswordAllowed(
  raw: string,
  limits: PasswordLimits,
): string {
  const normalized = normalizePassword(raw);
  // Code points, not UTF-16 units: an emoji must not count as two characters.
  const length = [...normalized].length;

  if (length < limits.minLength) {
    throw new PasswordPolicyError('TOO_SHORT');
  }

  if (length > limits.maxLength) {
    throw new PasswordPolicyError('TOO_LONG');
  }

  return normalized;
}
