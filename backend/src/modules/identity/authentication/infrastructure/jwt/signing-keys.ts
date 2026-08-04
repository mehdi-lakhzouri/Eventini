import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';

import { AccessTokenError } from './access-token.errors';

export interface SigningKeySettings {
  readonly privateKey: string;
  readonly publicKey: string;
  readonly keyId: string;
  /** Verification-only, during a rotation overlap window (ADR-0005). */
  readonly previousPublicKey?: string | undefined;
  readonly previousKeyId?: string | undefined;
}

/** Accepts PEM directly, or base64-wrapped PEM. */
function toPem(raw: string): string {
  const trimmed = raw.trim();

  return trimmed.includes('-----BEGIN')
    ? trimmed
    : Buffer.from(trimmed, 'base64').toString('utf8');
}

/**
 * One signing key, several verification keys.
 *
 * The asymmetry is the rotation contract: step 2 of ADR-0005 accepts both
 * `kid`s for verification while signing only with the new one, for at least as
 * long as the longest refresh token lives. Dropping a `kid` from this set is
 * also the emergency revocation — every token signed with it stops verifying
 * at once, and sessions recover through a refresh.
 */
export class SigningKeySet {
  readonly activeKeyId: string;

  private readonly privateKey: KeyObject;
  private readonly publicKeys: ReadonlyMap<string, KeyObject>;

  constructor(settings: SigningKeySettings) {
    this.activeKeyId = settings.keyId;
    this.privateKey = createPrivateKey(toPem(settings.privateKey));

    const keys = new Map<string, KeyObject>([
      [settings.keyId, createPublicKey(toPem(settings.publicKey))],
    ]);

    if (
      settings.previousKeyId !== undefined &&
      settings.previousPublicKey !== undefined
    ) {
      if (settings.previousKeyId === settings.keyId) {
        throw new Error(
          'ACCESS_TOKEN_PREVIOUS_KEY_ID equals ACCESS_TOKEN_KEY_ID, so the ' +
            'rotation overlap window would accept the new key twice and the ' +
            'old key not at all.',
        );
      }

      keys.set(
        settings.previousKeyId,
        createPublicKey(toPem(settings.previousPublicKey)),
      );
    }

    this.publicKeys = keys;
  }

  signingKey(): KeyObject {
    return this.privateKey;
  }

  /** Throws rather than returning null: an unknown `kid` never reaches crypto. */
  verificationKey(keyId: unknown): KeyObject {
    if (typeof keyId !== 'string') {
      throw new AccessTokenError('UNKNOWN_KEY', 'no kid in the header');
    }

    const key = this.publicKeys.get(keyId);

    if (key === undefined) {
      throw new AccessTokenError('UNKNOWN_KEY', keyId);
    }

    return key;
  }

  get verificationKeyIds(): readonly string[] {
    return [...this.publicKeys.keys()];
  }
}
