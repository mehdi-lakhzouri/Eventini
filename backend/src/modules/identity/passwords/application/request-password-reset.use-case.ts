import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { authenticationConfig } from '../../../../config/authentication.config';
import { normalizeEmail } from '../../../../infrastructure/database/normalize-email';
import { PasswordResetTokenRepository } from '../domain/password-reset-token.repository';
import { issueResetToken } from '../domain/reset-token';

export interface ResetRequest {
  readonly email: string;
  readonly requestedIp: string | null;
}

@Injectable()
export class RequestPasswordResetUseCase {
  constructor(
    private readonly tokens: PasswordResetTokenRepository,
    @Inject(authenticationConfig.KEY)
    private readonly config: ConfigType<typeof authenticationConfig>,
  ) {}

  /**
   * Always resolves. The caller answers `202` either way, so this returns the
   * token only when there is somewhere to send it — an unknown address is not
   * an error, it is the same outcome with nothing to deliver.
   */
  async execute(request: ResetRequest): Promise<{ token: string } | null> {
    const normalizedEmail = normalizeEmail(request.email);
    const user = await this.tokens.findActiveUserByEmail(normalizedEmail);

    // Generated on both paths so the cryptographic work does not depend on
    // whether the account exists. What remains is one INSERT.
    const issued = issueResetToken(this.config.tokens.passwordResetSecret);

    if (user === null) {
      return null;
    }

    const now = new Date();

    await this.tokens.replacePending({
      userId: user.userId,
      tokenHash: issued.tokenHash,
      expiresAt: new Date(
        now.getTime() + this.config.lifetimes.passwordReset * 1000,
      ),
      requestedIp: request.requestedIp,
      now,
    });

    return { token: issued.token };
  }
}
