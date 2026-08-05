import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES-256-GCM. The TOTP secret is the one secret in this system that is
 * **encrypted rather than hashed**, because verifying a code requires reading
 * it back — §4.7 says so explicitly.
 *
 * GCM rather than CBC: it authenticates as well as encrypts, so a tampered
 * ciphertext fails loudly instead of decrypting to garbage that then fails
 * every TOTP check for reasons nobody can diagnose.
 *
 * A fresh random IV per encryption. Reusing one under the same key destroys
 * GCM's guarantees outright, which is why it is generated here and never
 * taken from a caller.
 */
export class MfaSecretCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');

    if (this.key.length !== 32) {
      throw new Error(
        `MFA_ENCRYPTION_KEY must decode to 32 bytes, got ${this.key.length}.`,
      );
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
      'base64',
    );
  }

  decrypt(payload: string): string {
    const raw = Buffer.from(payload, 'base64');

    if (raw.length <= IV_BYTES + TAG_BYTES) {
      throw new Error('MFA secret ciphertext is truncated');
    }

    const decipher = createDecipheriv(
      ALGORITHM,
      this.key,
      raw.subarray(0, IV_BYTES),
    );
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));

    return Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  }
}
