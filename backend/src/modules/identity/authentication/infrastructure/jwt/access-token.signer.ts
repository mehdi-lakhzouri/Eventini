import { Injectable } from '@nestjs/common';

import { toPayload, type AccessTokenClaims } from './access-token.claims';
import { loadJose } from './jose';
import { SigningKeySet } from './signing-keys';
import { audienceFor, type AudienceSettings } from './token-audience';

export interface SignerSettings extends AudienceSettings {
  readonly issuer: string;
}

export interface IssuedAccessToken {
  readonly token: string;
  readonly expiresAt: Date;
}

const ALGORITHM = 'EdDSA';

@Injectable()
export class AccessTokenSigner {
  constructor(
    private readonly keys: SigningKeySet,
    private readonly settings: SignerSettings,
  ) {}

  async issue(
    claims: AccessTokenClaims,
    ttlSeconds: number,
  ): Promise<IssuedAccessToken> {
    const { SignJWT } = await loadJose();

    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + ttlSeconds;

    // The payload is built from `claims`, never spread from a caller's object:
    // a password, an MFA secret or a permission list cannot leak into a token
    // that has no way to carry an unexpected key.
    const token = await new SignJWT(toPayload(claims))
      .setProtectedHeader({
        alg: ALGORITHM,
        kid: this.keys.activeKeyId,
        typ: 'JWT',
      })
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .setIssuer(this.settings.issuer)
      .setAudience(audienceFor(claims.clientType, this.settings))
      .sign(this.keys.signingKey());

    return { token, expiresAt: new Date(expiresAt * 1000) };
  }
}
