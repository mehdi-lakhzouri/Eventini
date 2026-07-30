import type { Env } from '../env.schema';
import type { EnvironmentRule } from './rule.types';
import { describeError } from '../describe-error';
import {
  MINIMUM_SECRET_BYTES,
  decodeBase64Secret,
  isExampleSecret,
} from '../parsers/secret.parser';

/**
 * The eight independent secrets of AUTHENTICATION_AUTHORIZATION.md §9.
 *
 * Key separation is the point: compromising the CSRF signing key must not also
 * compromise refresh tokens or MFA secrets. Rule 8 exists because that
 * separation is trivially undone by a copy-paste, and nothing else would notice.
 */
const SYMMETRIC_SECRET_KEYS = [
  'REFRESH_TOKEN_HMAC_SECRET',
  'CSRF_SECRET',
  'MFA_ENCRYPTION_KEY',
  'INVITATION_TOKEN_SECRET',
  'PASSWORD_RESET_TOKEN_SECRET',
  'PASSWORD_PEPPER',
  'COOKIE_SECRET',
] as const satisfies readonly (keyof Env)[];

/** Asymmetric material: checked for reuse and placeholders, not for 32-byte length. */
const KEY_MATERIAL_KEYS = [
  'ACCESS_TOKEN_PRIVATE_KEY',
  'ACCESS_TOKEN_PUBLIC_KEY',
  'QR_SIGNING_PRIVATE_KEY',
  'QR_SIGNING_PUBLIC_KEY',
] as const satisfies readonly (keyof Env)[];

/**
 * Rules 7, 8 and 9 — the three that catch genuine deployment mistakes rather
 * than typos.
 */
export const secretHygieneRule: EnvironmentRule = {
  id: '7-9',
  description:
    'Secrets are long enough, distinct, and not example placeholders',

  check(env) {
    const errors: string[] = [];

    // Rule 7 — a symmetric secret shorter than 32 bytes weakens every HMAC and
    // AES-GCM operation built on it, regardless of the algorithm's strength.
    for (const key of SYMMETRIC_SECRET_KEYS) {
      const raw = env[key];

      try {
        const decoded = decodeBase64Secret(raw);

        if (decoded.length < MINIMUM_SECRET_BYTES) {
          errors.push(
            `${key} must decode to at least ${MINIMUM_SECRET_BYTES} bytes, got ${decoded.length}. Generate one with: openssl rand -base64 32`,
          );
        }
      } catch (error) {
        errors.push(
          `${key} ${describeError(error)}. Generate one with: openssl rand -base64 32`,
        );
      }
    }

    // Rule 9 — .env.example placeholders are long enough to satisfy rule 7 on
    // purpose, so that this check is what reports them. Otherwise "you shipped
    // the example file" would surface as a confusing entropy complaint.
    for (const key of [...SYMMETRIC_SECRET_KEYS, ...KEY_MATERIAL_KEYS]) {
      if (isExampleSecret(env[key])) {
        errors.push(
          `${key} still holds the placeholder from .env.example. Replace it with a real generated value.`,
        );
      }
    }

    // Rule 8 — reuse silently collapses the seven-key separation into one.
    const seen = new Map<string, string>();

    for (const key of [...SYMMETRIC_SECRET_KEYS, ...KEY_MATERIAL_KEYS]) {
      const value = env[key].trim();
      const previous = seen.get(value);

      if (previous !== undefined) {
        errors.push(
          `${key} is identical to ${previous}. Every secret must be independent; reuse defeats the key separation of AUTHENTICATION_AUTHORIZATION.md §9.`,
        );
      } else {
        seen.set(value, key);
      }
    }

    return errors;
  },
};
