import { Injectable } from '@nestjs/common';

import {
  AUTHENTICATION_LEVELS,
  SESSION_CLIENT_TYPES,
  type AuthenticationLevel,
  type SessionClientType,
} from '../../../../../infrastructure/database/enums';
import type { VerifiedAccessToken } from './access-token.claims';
import { AccessTokenError } from './access-token.errors';
import { loadJose } from './jose';
import { SigningKeySet } from './signing-keys';
import { audienceFor, type AudienceSettings } from './token-audience';

export interface VerifierSettings extends AudienceSettings {
  readonly issuer: string;
  readonly clockToleranceSeconds: number;
}

/**
 * Passed explicitly to `jwtVerify` and never read from the token header. This
 * single line is what blocks algorithm confusion: a token claiming `none`, or
 * `HS256` signed with the Ed25519 public key as an HMAC secret, is refused
 * before its signature is examined.
 */
const ALLOWED_ALGORITHMS = ['EdDSA'];

@Injectable()
export class AccessTokenVerifier {
  constructor(
    private readonly keys: SigningKeySet,
    private readonly settings: VerifierSettings,
  ) {}

  /**
   * `expectedClientType` fixes which audience is accepted. The caller knows
   * which API is being addressed; the token does not get to choose.
   */
  async verify(
    token: string,
    expectedClientType: SessionClientType,
  ): Promise<VerifiedAccessToken> {
    const { jwtVerify } = await loadJose();

    const result = await jwtVerify(
      token,
      // Resolving the key by `kid` here means an unrecognised one is refused
      // before any cryptography runs, which is also how a revoked key stops
      // working the moment it leaves the set.
      (header) => this.keys.verificationKey(header.kid),
      {
        algorithms: ALLOWED_ALGORITHMS,
        issuer: this.settings.issuer,
        audience: audienceFor(expectedClientType, this.settings),
        clockTolerance: this.settings.clockToleranceSeconds,
        typ: 'JWT',
      },
    ).catch((error: unknown) => {
      throw toAccessTokenError(error);
    });

    return {
      ...readClaims(result.payload),
      keyId: requireString(result.protectedHeader.kid, 'kid'),
      issuedAt: new Date(requireNumber(result.payload.iat, 'iat') * 1000),
      expiresAt: new Date(requireNumber(result.payload.exp, 'exp') * 1000),
    };
  }
}

function toAccessTokenError(error: unknown): AccessTokenError {
  if (error instanceof AccessTokenError) {
    return error;
  }

  const raw = (error as { code?: unknown }).code;
  const code = typeof raw === 'string' ? raw : 'unknown';

  switch (code) {
    case 'ERR_JWT_EXPIRED':
      return new AccessTokenError('EXPIRED');
    case 'ERR_JOSE_ALG_NOT_ALLOWED':
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
      return new AccessTokenError('BAD_SIGNATURE', code);
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED': {
      const claim = (error as { claim?: unknown }).claim;
      const rejection =
        claim === 'iss'
          ? 'BAD_ISSUER'
          : claim === 'aud'
            ? 'BAD_AUDIENCE'
            : 'BAD_CLAIMS';

      return new AccessTokenError(
        rejection,
        typeof claim === 'string' ? claim : undefined,
      );
    }
    default:
      return new AccessTokenError('MALFORMED', code);
  }
}

/**
 * Every claim is checked here rather than cast. The authorization chain reads
 * `ver`, `sid` and `org` to make decisions; a missing one must be a rejection,
 * not an `undefined` compared against something.
 */
function readClaims(payload: Record<string, unknown>): {
  userId: string;
  sessionId: string;
  organizationId: string | null;
  membershipId: string | null;
  userVersion: number;
  clientType: SessionClientType;
  authLevel: AuthenticationLevel;
} {
  return {
    userId: requireString(payload['sub'], 'sub'),
    sessionId: requireString(payload['sid'], 'sid'),
    organizationId: requireNullableString(payload['org'], 'org'),
    membershipId: requireNullableString(payload['mbr'], 'mbr'),
    userVersion: requireNumber(payload['ver'], 'ver'),
    clientType: requireMember(payload['ct'], SESSION_CLIENT_TYPES, 'ct'),
    authLevel: requireMember(payload['al'], AUTHENTICATION_LEVELS, 'al'),
  };
}

function requireString(value: unknown, claim: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AccessTokenError('BAD_CLAIMS', claim);
  }

  return value;
}

function requireNullableString(value: unknown, claim: string): string | null {
  if (value === null) {
    return null;
  }

  return requireString(value, claim);
}

function requireNumber(value: unknown, claim: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AccessTokenError('BAD_CLAIMS', claim);
  }

  return value;
}

function requireMember<T extends string>(
  value: unknown,
  allowed: readonly T[],
  claim: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new AccessTokenError('BAD_CLAIMS', claim);
  }

  return value as T;
}
