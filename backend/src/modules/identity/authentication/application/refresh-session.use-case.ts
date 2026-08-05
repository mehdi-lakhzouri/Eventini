import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { authenticationConfig } from '../../../../config/authentication.config';
import {
  hashRefreshToken,
  issueRefreshToken,
} from '../../sessions/domain/refresh-token';
import {
  RotationConflictError,
  RotationRepository,
} from '../../sessions/domain/rotation.repository';
import {
  deadlinesFor,
  profileFor,
} from '../../sessions/domain/session-profile';
import { sessionUnusableReason } from '../../sessions/domain/session-state';
import { RotationError } from '../domain/rotation.errors';
import { accessTokenTtlSeconds } from '../infrastructure/jwt/access-token.lifetime';
import { AccessTokenSigner } from '../infrastructure/jwt/access-token.signer';

export interface RefreshResult {
  readonly sessionId: string;
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
}

@Injectable()
export class RefreshSessionUseCase {
  constructor(
    private readonly rotations: RotationRepository,
    private readonly signer: AccessTokenSigner,
    @Inject(authenticationConfig.KEY)
    private readonly config: ConfigType<typeof authenticationConfig>,
  ) {}

  async execute(presentedToken: string): Promise<RefreshResult> {
    const tokenHash = hashRefreshToken(
      presentedToken,
      this.config.refreshToken.hmacSecret,
    );
    const current = await this.rotations.findByTokenHash(tokenHash);

    if (current === null) {
      throw new RotationError('UNKNOWN_TOKEN');
    }

    const now = new Date();

    // §5.3. A row that is not ACTIVE means this token was already spent, so
    // someone is holding a copy. Which of the two is legitimate is unknowable,
    // so the whole family falls and neither keeps access.
    if (current.status !== 'ACTIVE') {
      await this.rotations.recordReuse({
        rotationId: current.rotationId,
        sessionId: current.session.sessionId,
        tokenFamilyId: current.tokenFamilyId,
        now,
      });

      throw new RotationError('REUSE_DETECTED');
    }

    if (current.expiresAt.getTime() <= now.getTime()) {
      throw new RotationError('TOKEN_EXPIRED');
    }

    const unusable = sessionUnusableReason(current.session, now);

    if (unusable !== null) {
      throw new RotationError(
        unusable === 'NOT_ACTIVE'
          ? 'SESSION_REVOKED'
          : unusable === 'IDLE_EXPIRED'
            ? 'SESSION_IDLE_EXPIRED'
            : 'SESSION_ABSOLUTE_EXPIRED',
      );
    }

    const profile = profileFor(
      current.session.clientType,
      current.session.hasPlatformRole,
    );
    const deadlines = deadlinesFor(profile, this.config.lifetimes, now);
    const next = issueRefreshToken(this.config.refreshToken.hmacSecret);

    try {
      await this.rotations.rotate({
        currentRotationId: current.rotationId,
        sessionId: current.session.sessionId,
        tokenFamilyId: current.tokenFamilyId,
        nextTokenHash: next.tokenHash,
        nextExpiresAt: deadlines.refreshExpiresAt,
        // Only the idle deadline moves. The absolute one is what stops a
        // session living forever by being used forever.
        idleExpiresAt: deadlines.idleExpiresAt,
        now,
      });
    } catch (error: unknown) {
      if (error instanceof RotationConflictError) {
        throw new RotationError('CONCURRENT_ROTATION');
      }

      throw error;
    }

    const access = await this.signer.issue(
      {
        userId: current.session.userId,
        sessionId: current.session.sessionId,
        organizationId: current.session.organizationId,
        membershipId: current.session.membershipId,
        // Read fresh with the session, not carried over from the old token,
        // so a revocation that bumped it takes effect on this rotation.
        userVersion: current.session.userVersion,
        clientType: current.session.clientType,
        authLevel: current.session.authenticationLevel,
      },
      accessTokenTtlSeconds(
        current.session.clientType,
        current.session.hasPlatformRole,
        this.config.lifetimes.accessToken,
      ),
    );

    return {
      sessionId: current.session.sessionId,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: next.token,
      refreshTokenExpiresAt: deadlines.refreshExpiresAt,
    };
  }
}
