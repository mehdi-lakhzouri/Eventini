import type {
  AuthenticationLevel,
  SessionClientType,
} from '../../../../../infrastructure/database/enums';

/** ADR-0005's claim set. Nothing else is ever signed. */
export interface AccessTokenClaims {
  /** `sub` — users.id */
  readonly userId: string;
  /** `sid` — user_sessions.id, the key to the server-side check */
  readonly sessionId: string;
  /** `org` — null for a PLATFORM session */
  readonly organizationId: string | null;
  /** `mbr` — null for a PLATFORM session */
  readonly membershipId: string | null;
  /** `ver` — users.version; a mismatch invalidates the token (chain step 3) */
  readonly userVersion: number;
  /** `ct` */
  readonly clientType: SessionClientType;
  /** `al` */
  readonly authLevel: AuthenticationLevel;
}

export interface VerifiedAccessToken extends AccessTokenClaims {
  readonly keyId: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

/**
 * The exact payload keys ADR-0005 permits, beyond the registered `iat`, `exp`,
 * `iss` and `aud`. A password, a hash, an MFA secret, a refresh token or a
 * permission list must never appear, and the surest way to guarantee that is
 * for the payload to be built from this shape rather than passed through.
 */
export const PAYLOAD_CLAIMS = [
  'sub',
  'sid',
  'org',
  'mbr',
  'ver',
  'ct',
  'al',
] as const;

export function toPayload(claims: AccessTokenClaims): Record<string, unknown> {
  return {
    sub: claims.userId,
    sid: claims.sessionId,
    org: claims.organizationId,
    mbr: claims.membershipId,
    ver: claims.userVersion,
    ct: claims.clientType,
    al: claims.authLevel,
  };
}
