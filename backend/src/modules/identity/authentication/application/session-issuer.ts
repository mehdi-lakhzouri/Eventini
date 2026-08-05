import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { authenticationConfig } from '../../../../config/authentication.config';
import type {
  AuthenticationLevel,
  SessionClientType,
} from '../../../../infrastructure/database/enums';
import { TransactionManager } from '../../../../infrastructure/database/transaction.manager';
import { issueRefreshToken } from '../../sessions/domain/refresh-token';
import {
  deadlinesFor,
  profileFor,
} from '../../sessions/domain/session-profile';
import { SessionRepository } from '../../sessions/domain/session.repository';
import { AuthenticationError } from '../domain/authentication.errors';
import type { AuthenticationCandidate } from '../domain/authentication.repository';
import { resolveOrganization } from '../domain/organization-resolution';
import { accessTokenTtlSeconds } from '../infrastructure/jwt/access-token.lifetime';
import { AccessTokenSigner } from '../infrastructure/jwt/access-token.signer';

export interface IssuedSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly organizationId: string | null;
  readonly membershipId: string | null;
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
  /** True when several organizations were usable and none was chosen. */
  readonly requiresOrganizationSelection: boolean;
}

export interface IssueSessionCommand {
  readonly candidate: AuthenticationCandidate;
  readonly clientType: SessionClientType;
  readonly authenticationLevel: AuthenticationLevel;
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
  readonly requestId: string | null;
}

/**
 * Steps 11 to 15 of §5.1, owned in one place.
 *
 * Login reaches them directly; a login gated by MFA reaches them only once the
 * challenge is answered. Both must produce exactly the same session, so this
 * is a single implementation with the authentication level as a parameter
 * rather than two paths that have to be kept in agreement by hand.
 */
@Injectable()
export class SessionIssuer {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly signer: AccessTokenSigner,
    private readonly transactions: TransactionManager,
    @Inject(authenticationConfig.KEY)
    private readonly config: ConfigType<typeof authenticationConfig>,
  ) {}

  async issue(command: IssueSessionCommand): Promise<IssuedSession> {
    const { candidate } = command;

    // Steps 11 to 13.
    const resolution = resolveOrganization(
      candidate.memberships,
      candidate.hasPlatformRole,
    );

    if (resolution.kind === 'ORGANIZATION_UNAVAILABLE') {
      throw new AuthenticationError('ORGANIZATION_UNAVAILABLE');
    }

    if (resolution.kind === 'DENIED') {
      throw new AuthenticationError('NO_ACCESS');
    }

    const organizationId =
      resolution.kind === 'TENANT' ? resolution.organizationId : null;
    const membershipId =
      resolution.kind === 'TENANT' ? resolution.membershipId : null;

    const profile = profileFor(command.clientType, candidate.hasPlatformRole);
    const now = new Date();
    const deadlines = deadlinesFor(profile, this.config.lifetimes, now);
    const refresh = issueRefreshToken(this.config.refreshToken.hmacSecret);

    // Step 14. One transaction: a session without its first refresh token is
    // a session nobody can ever continue.
    const created = await this.transactions.runInTransaction(async (tx) => {
      const result = await this.sessions.createWithRefreshToken(
        tx,
        {
          userId: candidate.userId,
          organizationId,
          membershipId,
          clientType: command.clientType,
          authenticationLevel: command.authenticationLevel,
          idleExpiresAt: deadlines.idleExpiresAt,
          absoluteExpiresAt: deadlines.absoluteExpiresAt,
          userAgent: command.userAgent,
          ipAddress: command.ipAddress,
          requestId: command.requestId,
        },
        { tokenHash: refresh.tokenHash, expiresAt: deadlines.refreshExpiresAt },
      );

      await this.sessions.touchLastLogin(tx, candidate.userId, now);

      return result;
    });

    // Step 15. The `al` claim carries the same level as the row, so a guard
    // demanding MFA can decide from the token alone.
    const access = await this.signer.issue(
      {
        userId: candidate.userId,
        sessionId: created.sessionId,
        organizationId,
        membershipId,
        userVersion: candidate.userVersion,
        clientType: command.clientType,
        authLevel: command.authenticationLevel,
      },
      accessTokenTtlSeconds(
        command.clientType,
        candidate.hasPlatformRole,
        this.config.lifetimes.accessToken,
      ),
    );

    return {
      sessionId: created.sessionId,
      userId: candidate.userId,
      organizationId,
      membershipId,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: refresh.token,
      refreshTokenExpiresAt: deadlines.refreshExpiresAt,
      requiresOrganizationSelection: resolution.kind === 'AMBIGUOUS',
    };
  }
}
