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

/** A session whose organization has already been decided by the caller. */
export interface ResolvedSessionCommand {
  readonly userId: string;
  readonly userVersion: number;
  readonly hasPlatformRole: boolean;
  readonly organizationId: string | null;
  readonly membershipId: string | null;
  readonly clientType: SessionClientType;
  readonly authenticationLevel: AuthenticationLevel;
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
  readonly requestId: string | null;
  /** Retired in the same transaction as the successor. */
  readonly replacingSessionId?: string;
  readonly requiresOrganizationSelection?: boolean;
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

    return this.issueResolved({
      userId: candidate.userId,
      userVersion: candidate.userVersion,
      hasPlatformRole: candidate.hasPlatformRole,
      organizationId,
      membershipId,
      clientType: command.clientType,
      authenticationLevel: command.authenticationLevel,
      userAgent: command.userAgent,
      ipAddress: command.ipAddress,
      requestId: command.requestId,
      requiresOrganizationSelection: resolution.kind === 'AMBIGUOUS',
    });
  }

  /**
   * Steps 14 and 15, with the organization already decided.
   *
   * Login reaches this through `issue`, which resolves the organization first.
   * The organization switch of EVT-033 reaches it directly: the target is
   * chosen by the caller and already checked against their memberships, so
   * re-running the resolution would either ignore that choice or re-derive it.
   *
   * `replacingSessionId` retires the predecessor **inside the same
   * transaction** as the successor. Committing them separately would leave a
   * window with two live sessions, or — if the second failed — none at all.
   */
  async issueResolved(command: ResolvedSessionCommand): Promise<IssuedSession> {
    const profile = profileFor(command.clientType, command.hasPlatformRole);
    const now = new Date();
    const deadlines = deadlinesFor(profile, this.config.lifetimes, now);
    const refresh = issueRefreshToken(this.config.refreshToken.hmacSecret);

    // Step 14. One transaction: a session without its first refresh token is
    // a session nobody can ever continue.
    const created = await this.transactions.runInTransaction(async (tx) => {
      const result = await this.sessions.createWithRefreshToken(
        tx,
        {
          userId: command.userId,
          organizationId: command.organizationId,
          membershipId: command.membershipId,
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

      if (command.replacingSessionId !== undefined) {
        await this.sessions.replaceSession(tx, {
          sessionId: command.replacingSessionId,
          userId: command.userId,
          now,
        });
      } else {
        // Only a real sign-in moves `last_login_at`. A context switch is not
        // a new login, and treating it as one would make the column useless
        // for spotting when an account was actually used.
        await this.sessions.touchLastLogin(tx, command.userId, now);
      }

      return result;
    });

    // Step 15. The `al` claim carries the same level as the row, so a guard
    // demanding MFA can decide from the token alone.
    const access = await this.signer.issue(
      {
        userId: command.userId,
        sessionId: created.sessionId,
        organizationId: command.organizationId,
        membershipId: command.membershipId,
        userVersion: command.userVersion,
        clientType: command.clientType,
        authLevel: command.authenticationLevel,
      },
      accessTokenTtlSeconds(
        command.clientType,
        command.hasPlatformRole,
        this.config.lifetimes.accessToken,
      ),
    );

    return {
      sessionId: created.sessionId,
      userId: command.userId,
      organizationId: command.organizationId,
      membershipId: command.membershipId,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: refresh.token,
      refreshTokenExpiresAt: deadlines.refreshExpiresAt,
      requiresOrganizationSelection:
        command.requiresOrganizationSelection ?? false,
    };
  }
}
