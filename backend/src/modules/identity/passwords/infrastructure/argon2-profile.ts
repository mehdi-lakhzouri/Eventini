import * as argon2 from 'argon2';

/** `user_credentials.password_version` for the ADR-0007 profile. */
export const PASSWORD_PROFILE_VERSION = 1;

export interface Argon2Settings {
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
  readonly hashLength: number;
  /** Base64, 32 bytes. Validated by the secret-hygiene environment rule. */
  readonly pepper: string;
}

export type Argon2Options = argon2.HashOptions & {
  readonly hashLength: number;
  readonly secret: Buffer;
};

export function buildArgon2Options(settings: Argon2Settings): Argon2Options {
  return {
    type: argon2.argon2id,
    memoryCost: settings.memoryCost,
    timeCost: settings.timeCost,
    parallelism: settings.parallelism,
    hashLength: settings.hashLength,
    // Argon2's native `secret`, not a second hashing layer (ADR-0007).
    secret: Buffer.from(settings.pepper, 'base64'),
  };
}

/** Bytes of the raw digest, decoded from the trailing base64 segment. */
export function encodedHashLength(encoded: string): number {
  const raw = encoded.split('$').at(-1) ?? '';

  return Buffer.from(raw, 'base64').length;
}

/**
 * `argon2.needsRehash` compares m, t and p but ignores hash length, so a
 * shortened digest would otherwise never be upgraded.
 */
export function isStaleHash(encoded: string, options: Argon2Options): boolean {
  return (
    argon2.needsRehash(encoded, options) ||
    encodedHashLength(encoded) !== options.hashLength
  );
}
