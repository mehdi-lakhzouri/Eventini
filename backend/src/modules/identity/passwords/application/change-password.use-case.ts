import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { authenticationConfig } from '../../../../config/authentication.config';
import { EmailEventPublisher } from '../../../../infrastructure/email';
import { RevocationRepository } from '../../sessions/domain/revocation.repository';
import { PasswordHasher } from '../domain/password-hasher';
import { PasswordFlowError } from '../domain/password.errors';
import { PasswordResetTokenRepository } from '../domain/password-reset-token.repository';
import { assertPasswordAllowed } from '../domain/password.policy';

@Injectable()
export class ChangePasswordUseCase {
  constructor(
    private readonly credentials: PasswordResetTokenRepository,
    private readonly hasher: PasswordHasher,
    private readonly sessions: RevocationRepository,
    @Inject(authenticationConfig.KEY)
    private readonly config: ConfigType<typeof authenticationConfig>,
    private readonly emailEvents: EmailEventPublisher,
  ) {}

  async execute(input: {
    userId: string;
    currentSessionId: string;
    currentPassword: string;
    newPassword: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    const password = assertPasswordAllowed(
      input.newPassword,
      this.config.password,
    );

    const credential = await this.credentials.findCredential(input.userId);

    // The current password is required. Reauthentication is the documented
    // alternative (§6.5) and arrives with the guard that can prove it; until
    // then the password is the only proof available, so it is not optional.
    if (credential?.passwordHash == null) {
      throw new PasswordFlowError('WRONG_CURRENT_PASSWORD');
    }

    const verified = await this.hasher.verify(
      credential.passwordHash,
      input.currentPassword,
    );

    if (!verified.valid) {
      throw new PasswordFlowError('WRONG_CURRENT_PASSWORD');
    }

    const now = new Date();

    await this.credentials.setPassword({
      userId: input.userId,
      passwordHash: await this.hasher.hash(password),
      passwordVersion: this.hasher.version,
      now,
    });

    // The other sessions only. `users.version` is deliberately not bumped:
    // it would invalidate this session's own access token, which is the
    // opposite of what changing a password from a trusted browser means.
    await this.sessions.revokeOtherSessions({
      userId: input.userId,
      keepSessionId: input.currentSessionId,
      revokedBy: input.userId,
      reason: 'PASSWORD_CHANGED',
      now,
    });

    await this.emailEvents.publish({
      type: 'PASSWORD_CHANGED',
      userId: input.userId,
      occurredAt: now,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
  }
}
