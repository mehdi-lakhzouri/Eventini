/**
 * Base64 secret handling.
 *
 * Secrets are carried as base64 (`ENVIRONMENT_VARIABLES.md` §1) so they survive
 * `.env` files and secret managers without escaping problems.
 */

/** Minimum entropy for a symmetric secret, per ENVIRONMENT_VARIABLES.md rule 7. */
export const MINIMUM_SECRET_BYTES = 32;

/**
 * The marker embedded in every placeholder secret in `.env.example`.
 *
 * Rule 7 (length) alone would not catch a copied example file: the placeholders
 * are long enough to pass it. Rule 9 decodes the value and looks for this
 * marker, so "you deployed the example file" produces that message rather than
 * a misleading one about entropy.
 */
export const EXAMPLE_SECRET_MARKER = 'EXAMPLE-DO-NOT-USE';

export class SecretParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretParseError';
  }
}

/**
 * Decodes a base64 secret.
 *
 * `Buffer.from(x, 'base64')` never throws — it silently ignores anything that
 * is not a base64 character, so a typo becomes a shorter key instead of an
 * error. Re-encoding and comparing is what turns that silence into a failure.
 */
export function decodeBase64Secret(raw: string): Buffer {
  const trimmed = raw.trim();
  const decoded = Buffer.from(trimmed, 'base64');

  if (decoded.length === 0) {
    throw new SecretParseError('decodes to an empty value');
  }

  if (
    decoded.toString('base64').replace(/=+$/, '') !== trimmed.replace(/=+$/, '')
  ) {
    throw new SecretParseError('is not valid base64');
  }

  return decoded;
}

/** True when the decoded secret carries the `.env.example` placeholder marker. */
export function isExampleSecret(raw: string): boolean {
  try {
    return decodeBase64Secret(raw)
      .toString('utf8')
      .includes(EXAMPLE_SECRET_MARKER);
  } catch {
    // Not decodable, so not an example placeholder. Rule 7 reports it instead.
    return false;
  }
}
