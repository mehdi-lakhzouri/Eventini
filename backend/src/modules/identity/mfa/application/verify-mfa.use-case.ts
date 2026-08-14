import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { authenticationConfig } from '../../../../config/authentication.config';
import { MfaChallengeStore } from '../domain/mfa-challenge.store';
import { MfaError } from '../domain/mfa.errors';
import { MfaRepository } from '../domain/mfa.repository';
import { recoveryCodeMatches } from '../domain/recovery-codes';
import { verifyTotp } from '../domain/totp';
import { MfaSecretCipher } from '../infrastructure/mfa-secret.cipher';

export interface VerifiedChallenge {
  readonly userId: string;
  readonly usedRecoveryCode: boolean;
}

@Injectable()
export class VerifyMfaUseCase {
  constructor(
    private readonly challenges: MfaChallengeStore,
    private readonly methods: MfaRepository,
    private readonly cipher: MfaSecretCipher,
    @Inject(authenticationConfig.KEY)
    private readonly auth: ConfigType<typeof authenticationConfig>,
  ) {}

  /**
   * Accepts a TOTP code or a recovery code. Success consumes the challenge,
   * so a verified challenge cannot be replayed into a second session.
   */
  async execute(input: {
    challengeId: string;
    code: string;
  }): Promise<VerifiedChallenge> {
    const challenge = await this.challenges.find(input.challengeId);

    if (challenge === null) {
      throw new MfaError('CHALLENGE_NOT_FOUND');
    }

    const method = await this.methods.findActiveMethod(challenge.userId);

    if (method === null) {
      throw new MfaError('NO_ACTIVE_METHOD');
    }

    const secret = this.cipher.decrypt(method.encryptedSecret);
    const totpValid = await verifyTotp(secret, input.code, {
      digits: this.auth.mfa.totpDigits,
      periodSeconds: this.auth.mfa.totpPeriodSeconds,
      driftWindows: this.auth.mfa.totpDriftWindows,
    });

    if (totpValid) {
      await this.challenges.destroy(input.challengeId);

      return { userId: challenge.userId, usedRecoveryCode: false };
    }

    if (await this.tryRecoveryCode(method.methodId, input.code)) {
      await this.challenges.destroy(input.challengeId);

      return { userId: challenge.userId, usedRecoveryCode: true };
    }

    const attempts = await this.challenges.recordFailure(input.challengeId);

    // Exhausted challenges are destroyed by the store, so this and a
    // challenge that never existed become indistinguishable a moment later.
    throw new MfaError(
      attempts !== null && attempts >= this.auth.mfa.challengeMaxAttempts
        ? 'CHALLENGE_EXHAUSTED'
        : 'INVALID_CODE',
    );
  }

  private async tryRecoveryCode(
    methodId: string,
    code: string,
  ): Promise<boolean> {
    const available = await this.methods.listAvailableRecoveryCodes(methodId);
    const match = available.find((candidate) =>
      recoveryCodeMatches(code, candidate.codeHash),
    );

    if (match === undefined) {
      return false;
    }

    // Consumption is conditional in the repository, so two requests carrying
    // the same printed code cannot both succeed.
    return this.methods.consumeRecoveryCode({
      codeId: match.codeId,
      now: new Date(),
    });
  }
}
