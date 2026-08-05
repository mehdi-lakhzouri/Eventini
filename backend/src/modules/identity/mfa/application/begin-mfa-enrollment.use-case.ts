import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { authenticationConfig } from '../../../../config/authentication.config';
import { MfaError } from '../domain/mfa.errors';
import { MfaRepository } from '../domain/mfa.repository';
import { generateTotpSecret, totpUri } from '../domain/totp';
import { MfaSecretCipher } from '../infrastructure/mfa-secret.cipher';

/** Shown in the authenticator app next to the account name. */
const ISSUER = 'Eventini';

export interface StartedEnrollment {
  readonly methodId: string;
  /** Shown once, in the QR code. Never returned again after confirmation. */
  readonly uri: string;
  readonly secret: string;
}

@Injectable()
export class BeginMfaEnrollmentUseCase {
  constructor(
    private readonly methods: MfaRepository,
    private readonly cipher: MfaSecretCipher,
    @Inject(authenticationConfig.KEY)
    private readonly auth: ConfigType<typeof authenticationConfig>,
  ) {}

  async execute(input: { userId: string }): Promise<StartedEnrollment> {
    const accountName = await this.methods.findAccountName(input.userId);

    if (accountName === null) {
      throw new MfaError('ACCOUNT_UNKNOWN');
    }

    const secret = generateTotpSecret();

    const methodId = await this.methods.startEnrollment({
      userId: input.userId,
      // Encrypted before it touches the database, so the plaintext exists
      // only in this function and in the response that shows the QR code.
      encryptedSecret: this.cipher.encrypt(secret),
      now: new Date(),
    });

    return {
      methodId,
      secret,
      uri: totpUri({
        secret,
        accountName,
        issuer: ISSUER,
        settings: this.settings(),
      }),
    };
  }

  private settings() {
    return {
      digits: this.auth.mfa.totpDigits,
      periodSeconds: this.auth.mfa.totpPeriodSeconds,
      driftWindows: this.auth.mfa.totpDriftWindows,
    };
  }
}
