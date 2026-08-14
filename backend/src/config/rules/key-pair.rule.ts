import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

import type { Env } from '../env.schema';
import type { EnvironmentRule } from './rule.types';
import { describeError } from '../describe-error';

interface KeyPairSpec {
  readonly label: string;
  readonly privateKeyVar: keyof Env;
  readonly publicKeyVar: keyof Env;
}

const KEY_PAIRS: readonly KeyPairSpec[] = [
  {
    label: 'Access token signing',
    privateKeyVar: 'ACCESS_TOKEN_PRIVATE_KEY',
    publicKeyVar: 'ACCESS_TOKEN_PUBLIC_KEY',
  },
  {
    label: 'QR signing',
    privateKeyVar: 'QR_SIGNING_PRIVATE_KEY',
    publicKeyVar: 'QR_SIGNING_PUBLIC_KEY',
  },
];

/** Decodes base64-wrapped PEM, or accepts PEM directly. */
function toPem(raw: string): string {
  const trimmed = raw.trim();

  if (trimmed.includes('-----BEGIN')) {
    return trimmed;
  }

  return Buffer.from(trimmed, 'base64').toString('utf8');
}

/**
 * Rule 10 — the public key actually corresponds to the private key.
 *
 * A mismatched pair is the nastiest configuration error in this list because it
 * fails *late and selectively*: the service starts, issues tokens happily, and
 * then rejects every one of them at verification. Every user is locked out with
 * a generic 401 and nothing in the logs points at the keys.
 *
 * Verified by actually signing a probe and checking the signature, rather than
 * comparing key fingerprints. Signing is the operation the application performs,
 * so it is the operation worth proving works.
 */
export const keyPairRule: EnvironmentRule = {
  id: '10',
  description: 'Each public key matches its private key',

  check(env) {
    const errors: string[] = [];

    for (const pair of KEY_PAIRS) {
      const privateRaw = env[pair.privateKeyVar];
      const publicRaw = env[pair.publicKeyVar];

      if (typeof privateRaw !== 'string' || typeof publicRaw !== 'string') {
        continue;
      }

      try {
        const privateKey = createPrivateKey(toPem(privateRaw));
        const publicKey = createPublicKey(toPem(publicRaw));

        if (privateKey.asymmetricKeyType !== 'ed25519') {
          errors.push(
            `${pair.privateKeyVar} must be an Ed25519 private key (ADR-0005), got ${String(privateKey.asymmetricKeyType)}.`,
          );
          continue;
        }

        if (publicKey.asymmetricKeyType !== 'ed25519') {
          errors.push(
            `${pair.publicKeyVar} must be an Ed25519 public key (ADR-0005), got ${String(publicKey.asymmetricKeyType)}.`,
          );
          continue;
        }

        // Ed25519 signs the message directly, hence the null algorithm.
        const probe = Buffer.from('eventini-key-pair-probe');
        const signature = sign(null, probe, privateKey);

        if (!verify(null, probe, publicKey, signature)) {
          errors.push(
            `${pair.publicKeyVar} does not match ${pair.privateKeyVar} (${pair.label}). Tokens would be signed and then rejected by their own verifier, locking out every user.`,
          );
        }
      } catch (error) {
        // Names both variables: an operator reading this needs to know which
        // entry to edit, not which human-friendly label the code uses.
        errors.push(
          `${pair.privateKeyVar} / ${pair.publicKeyVar} (${pair.label}) could not be loaded as an Ed25519 key pair: ${describeError(error)}. Expected base64-encoded PEM (ADR-0005); generate one with: node scripts/generate-dev-env.mjs`,
        );
      }
    }

    return errors;
  },
};
