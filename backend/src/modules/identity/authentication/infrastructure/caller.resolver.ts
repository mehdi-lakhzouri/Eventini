import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request } from 'express';

import { cookiesConfig } from '../../../../config/cookies.config';
import type {
  AuthenticationLevel,
  SessionClientType,
} from '../../../../infrastructure/database/enums';
import { RevocationRepository } from '../../sessions/domain/revocation.repository';
import { sessionUnusableReason } from '../../sessions/domain/session-state';
import { AccessTokenVerifier } from './jwt/access-token.verifier';

export interface Caller {
  readonly userId: string;
  readonly sessionId: string;
  readonly organizationId: string | null;
  readonly membershipId: string | null;
  readonly clientType: SessionClientType;
  readonly authenticationLevel: AuthenticationLevel;
  /** Steps 4 and 5, decided by `TenantContextGuard`, not here. */
  readonly organizationStatus: string | null;
  readonly organizationEnabled: boolean | null;
  readonly membershipStatus: string | null;
}

export type CallerRejection =
  | 'NO_TOKEN'
  | 'BAD_TOKEN'
  | 'SESSION_GONE'
  | 'SESSION_EXPIRED'
  | 'STALE_VERSION'
  | 'USER_NOT_ACTIVE';

export class CallerError extends Error {
  constructor(readonly rejection: CallerRejection) {
    super(`Caller refused: ${rejection}`);
    this.name = 'CallerError';
  }
}

/**
 * Steps 1 to 3 of the authorization chain, and no further.
 *
 * Step 1 is the token's own validity, step 2 the session's, step 3 the user's
 * — including `version` matching the `ver` claim, which is what makes a global
 * logout take effect immediately instead of at the next expiry.
 *
 * Steps 4 to 8 are tenant, membership, permission, ownership and state. They
 * belong to the guard EVT-036 builds; the endpoints here are about the
 * caller's own sessions, so there is no tenant resource to check. When that
 * guard lands it replaces this class rather than wrapping it.
 */
@Injectable()
export class CallerResolver {
  constructor(
    private readonly verifier: AccessTokenVerifier,
    private readonly sessions: RevocationRepository,
    @Inject(cookiesConfig.KEY)
    private readonly cookies: ConfigType<typeof cookiesConfig>,
  ) {}

  async resolve(request: Request): Promise<Caller> {
    const token = readCookie(request, this.cookies.access.name);

    if (token === undefined) {
      throw new CallerError('NO_TOKEN');
    }

    // Step 1. Any rejection reason stays inside; the caller gets one 401.
    const claims = await this.verifier.verify(token, 'WEB').catch(() => {
      throw new CallerError('BAD_TOKEN');
    });

    const session = await this.sessions.findCallerSession(claims.sessionId);

    if (session === null) {
      throw new CallerError('SESSION_GONE');
    }

    // Step 2. A valid signature is not enough — AUTH-INV-004 is the reason
    // `user_sessions` exists at all.
    if (sessionUnusableReason(session, new Date()) !== null) {
      throw new CallerError('SESSION_EXPIRED');
    }

    // Step 3.
    if (session.userStatus !== 'ACTIVE') {
      throw new CallerError('USER_NOT_ACTIVE');
    }

    if (session.userVersion !== claims.userVersion) {
      throw new CallerError('STALE_VERSION');
    }

    return {
      userId: session.userId,
      sessionId: session.sessionId,
      organizationId: session.organizationId,
      membershipId: session.membershipId,
      clientType: session.clientType,
      authenticationLevel: session.authenticationLevel,
      organizationStatus: session.organizationStatus,
      organizationEnabled: session.organizationEnabled,
      membershipStatus: session.membershipStatus,
    };
  }
}

function readCookie(request: Request, name: string): string | undefined {
  const cookies = (request as { cookies?: Record<string, unknown> }).cookies;
  const value = cookies?.[name];

  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
