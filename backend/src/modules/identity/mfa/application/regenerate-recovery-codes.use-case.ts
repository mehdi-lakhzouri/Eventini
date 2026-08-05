import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { authenticationConfig } from '../../../../config/authentication.config';
import { MfaError } from '../domain/mfa.errors';
import { MfaRepository } from '../domain/mfa.repository';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
} from '../domain/recovery-codes';

@Injectable()
export class RegenerateRecoveryCodesUseCase {
  constructor(
    private readonly methods: MfaRepository,
    @Inject(authenticationConfig.KEY)
    private readonly auth: ConfigType<typeof authenticationConfig>,
  ) {}

  /**
   * The whole previous batch is revoked in the same transaction that writes
   * the new one. Regenerating must never leave a printed sheet half valid —
   * the user has to be able to throw the old one away.
   */
  async execute(userId: string): Promise<string[]> {
    const method = await this.methods.findActiveMethod(userId);

    if (method === null) {
      throw new MfaError('NO_ACTIVE_METHOD');
    }

    const codes = generateRecoveryCodes(this.auth.mfa.recoveryCodeCount);

    await this.methods.replaceRecoveryCodes({
      methodId: method.methodId,
      codeHashes: codes.map(hashRecoveryCode),
      now: new Date(),
    });

    return codes;
  }
}
