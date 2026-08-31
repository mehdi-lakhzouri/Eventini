import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { authenticationConfig } from '../../../../config/authentication.config';
import { EmailEventPublisher } from '../../../../infrastructure/email';
import { MfaError } from '../domain/mfa.errors';
import { MfaRepository } from '../domain/mfa.repository';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
} from '../domain/recovery-codes';
import { verifyTotp } from '../domain/totp';
import { MfaSecretCipher } from '../infrastructure/mfa-secret.cipher';

@Injectable()
export class ConfirmMfaEnrollmentUseCase {
  constructor(
    private readonly methods: MfaRepository,
    private readonly cipher: MfaSecretCipher,
    @Inject(authenticationConfig.KEY)
    private readonly auth: ConfigType<typeof authenticationConfig>,
    private readonly emailEvents: EmailEventPublisher,
  ) {}

  /**
   * Activation requires a working code. Without it a user could lock
   * themselves out by enrolling an authenticator that never had the secret.
   *
   * Returns the recovery codes **once**. They are hashed on the way into the
   * database and can never be read back.
   */
  async execute(input: {
    userId: string;
    enrollmentId: string;
    code: string;
  }): Promise<string[]> {
    const pending = await this.methods.findPendingMethod(input.userId);

    // The id from the path has to be the enrolment that is actually pending.
    // Starting a second enrolment abandons the first, and a client holding the
    // older QR code must be told so rather than quietly activating a secret
    // its user never scanned.
    if (pending === null || pending.methodId !== input.enrollmentId) {
      throw new MfaError('NO_PENDING_ENROLLMENT');
    }

    const secret = this.cipher.decrypt(pending.encryptedSecret);
    const valid = await verifyTotp(secret, input.code, {
      digits: this.auth.mfa.totpDigits,
      periodSeconds: this.auth.mfa.totpPeriodSeconds,
      driftWindows: this.auth.mfa.totpDriftWindows,
    });

    if (!valid) {
      throw new MfaError('INVALID_CODE');
    }

    const codes = generateRecoveryCodes(this.auth.mfa.recoveryCodeCount);

    const now = new Date();
    await this.methods.activate({
      userId: input.userId,
      methodId: pending.methodId,
      codeHashes: codes.map(hashRecoveryCode),
      now,
    });

    await this.emailEvents.publish({
      type: 'MFA_ENABLED',
      userId: input.userId,
      occurredAt: now,
    });

    return codes;
  }
}
