import { generate, generateSecret, generateURI, verify } from 'otplib';

/**
 * RFC 6238 parameters, fixed by DATABASE_SCHEMA.md §4.7 and absent from the
 * rest of the corpus.
 *
 * SHA-1 is not a lapse: RFC 6238 specifies it and authenticator applications
 * implement it. SHA-256 breaks Google Authenticator and several others. The
 * security here rests on the secret's entropy and the 30-second window, not
 * on the hash's collision resistance.
 */
export interface TotpSettings {
  readonly digits: number;
  readonly periodSeconds: number;
  /** ±1 window, so a clock a few seconds out still works. */
  readonly driftWindows: number;
}

/**
 * Lowercase, and it matters. otplib 13 types this as `HashAlgorithm`, and
 * `'SHA-1'` is not a member: passing it produces a *different code* rather
 * than an error, so enrolment and verification would still agree with each
 * other while disagreeing with every real authenticator app. The RFC 6238
 * Appendix B vectors in the spec file are what pin this down.
 */
const ALGORITHM = 'sha1';
/** 160 bits, per §4.7. */
const SECRET_BYTES = 20;

export function generateTotpSecret(): string {
  return generateSecret({ length: SECRET_BYTES });
}

export function totpUri(input: {
  secret: string;
  accountName: string;
  issuer: string;
  settings: TotpSettings;
}): string {
  return generateURI({
    secret: input.secret,
    label: input.accountName,
    issuer: input.issuer,
    digits: input.settings.digits,
    period: input.settings.periodSeconds,
    algorithm: ALGORITHM,
  });
}

export async function verifyTotp(
  secret: string,
  token: string,
  settings: TotpSettings,
): Promise<boolean> {
  // Rejected before reaching the library: a non-numeric or wrong-length token
  // is never a valid code, and refusing it here keeps malformed input out of
  // the crypto path.
  if (!new RegExp(`^\\d{${settings.digits}}$`).test(token)) {
    return false;
  }

  const result = await verify({
    secret,
    token,
    digits: settings.digits,
    period: settings.periodSeconds,
    algorithm: ALGORITHM,
    // Seconds, not windows. otplib 13 replaced v12's step-counting `window`
    // with `epochTolerance`, and an unknown `window` key is ignored — which
    // would have silently pinned drift tolerance to zero.
    epochTolerance: settings.driftWindows * settings.periodSeconds,
  });

  return result.valid;
}

/** Only used to prove an enrolment works before it is activated. */
export async function currentTotpCode(
  secret: string,
  settings: TotpSettings,
): Promise<string> {
  return generate({
    secret,
    digits: settings.digits,
    period: settings.periodSeconds,
    algorithm: ALGORITHM,
  });
}
