import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { authenticationConfig } from '../../../../config/authentication.config';
import { RevocationRepository } from '../../sessions/domain/revocation.repository';
import { PasswordHasher } from '../domain/password-hasher';
import { PasswordFlowError } from '../domain/password.errors';
import { PasswordResetTokenRepository } from '../domain/password-reset-token.repository';
import { assertPasswordAllowed } from '../domain/password.policy';
import { hashResetToken } from '../domain/reset-token';

@Injectable()
export class ResetPasswordUseCase {
  constructor(
    private readonly tokens: PasswordResetTokenRepository,
    private readonly hasher: PasswordHasher,
    private readonly sessions: RevocationRepository,
    @Inject(authenticationConfig.KEY)
    private readonly config: ConfigType<typeof authenticationConfig>,
  ) {}

  async execute(input: { token: string; newPassword: string }): Promise<void> {
    // Validated before the token is looked up: a rejected password must not
    // consume the link, or the user is left with neither.
    const password = assertPasswordAllowed(
      input.newPassword,
      this.config.password,
    );

    const tokenHash = hashResetToken(
      input.token,
      this.config.tokens.passwordResetSecret,
    );
    const pending = await this.tokens.findPendingByHash(tokenHash);

    if (pending === null) {
      throw new PasswordFlowError('INVALID_TOKEN');
    }

    const now = new Date();

    if (pending.expiresAt.getTime() <= now.getTime()) {
      throw new PasswordFlowError('TOKEN_EXPIRED');
    }

    const passwordHash = await this.hasher.hash(password);
    const consumed = await this.tokens.consumeAndSetPassword({
      tokenId: pending.tokenId,
      userId: pending.userId,
      passwordHash,
      passwordVersion: this.hasher.version,
      now,
    });

    if (!consumed) {
      throw new PasswordFlowError('TOKEN_ALREADY_USED');
    }

    // Every session, including the one that asked. Whoever forced the reset
    // may be holding a session too, and this is the only moment we can be
    // sure of removing it.
    await this.sessions.revokeAllSessions({
      userId: pending.userId,
      revokedBy: pending.userId,
      reason: 'PASSWORD_RESET_COMPLETED',
      now,
    });
  }
}
