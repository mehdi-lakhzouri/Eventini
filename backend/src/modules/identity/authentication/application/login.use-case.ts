import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { authenticationConfig } from '../../../../config/authentication.config';
import type { SessionClientType } from '../../../../infrastructure/database/enums';
import { normalizeEmail } from '../../../../infrastructure/database/normalize-email';
import { TransactionManager } from '../../../../infrastructure/database/transaction.manager';
import { PasswordHasher } from '../../passwords/domain/password-hasher';
import { issueRefreshToken } from '../../sessions/domain/refresh-token';
import {
  deadlinesFor,
  profileFor,
} from '../../sessions/domain/session-profile';
import { SessionRepository } from '../../sessions/domain/session.repository';
import { AuthenticationError } from '../domain/authentication.errors';
import { AuthenticationRepository } from '../domain/authentication.repository';
import { resolveOrganization } from '../domain/organization-resolution';
import { accessTokenTtlSeconds } from '../infrastructure/jwt/access-token.lifetime';
import { AccessTokenSigner } from '../infrastructure/jwt/access-token.signer';

export interface LoginCommand {
  readonly email: string;
  readonly password: string;
  readonly clientType: SessionClientType;
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
  readonly requestId: string | null;
}

export interface LoginResult {
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

@Injectable()
export class LoginUseCase {
  constructor(
    private readonly users: AuthenticationRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
    private readonly signer: AccessTokenSigner,
    private readonly transactions: TransactionManager,
    @Inject(authenticationConfig.KEY)
    private readonly config: ConfigType<typeof authenticationConfig>,
  ) {}

  async execute(command: LoginCommand): Promise<LoginResult> {
    const normalizedEmail = normalizeEmail(command.email);
    const candidate = await this.users.findCandidateByEmail(normalizedEmail);

    // Step 7. The verification runs whether or not the account exists, so the
    // response time does not disclose which addresses are registered. A
    // missing credential row takes the same path for the same reason.
    if (candidate === null || candidate.passwordHash === null) {
      await this.hasher.verifyDecoy(command.password);
      throw new AuthenticationError(
        candidate === null ? 'UNKNOWN_ACCOUNT' : 'NO_CREDENTIAL',
      );
    }

    const verification = await this.hasher.verify(
      candidate.passwordHash,
      command.password,
    );

    if (!verification.valid) {
      throw new AuthenticationError('BAD_PASSWORD');
    }

    // Step 9. Checked after the hash, not before: returning early for a
    // suspended account would make it answer faster than an active one.
    if (candidate.status !== 'ACTIVE') {
      throw new AuthenticationError('USER_NOT_ACTIVE');
    }

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
          // MFA gating is EVT-027, so every session starts at PASSWORD and no
          // code may assume otherwise.
          authenticationLevel: 'PASSWORD',
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

    // Step 15.
    const access = await this.signer.issue(
      {
        userId: candidate.userId,
        sessionId: created.sessionId,
        organizationId,
        membershipId,
        userVersion: candidate.userVersion,
        clientType: command.clientType,
        authLevel: 'PASSWORD',
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
