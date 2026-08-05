import { Module, forwardRef } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { authenticationConfig } from '../../../config/authentication.config';
import { AuthenticationModule } from '../authentication/authentication.module';
import { BeginMfaEnrollmentUseCase } from './application/begin-mfa-enrollment.use-case';
import { ConfirmMfaEnrollmentUseCase } from './application/confirm-mfa-enrollment.use-case';
import { DisableMfaUseCase } from './application/disable-mfa.use-case';
import { RegenerateRecoveryCodesUseCase } from './application/regenerate-recovery-codes.use-case';
import { VerifyMfaUseCase } from './application/verify-mfa.use-case';
import { MfaController } from './controllers/mfa.controller';
import { MfaChallengeStore } from './domain/mfa-challenge.store';
import { MfaRepository } from './domain/mfa.repository';
import { MemoryMfaChallengeStore } from './infrastructure/memory-mfa-challenge.store';
import { MfaSecretCipher } from './infrastructure/mfa-secret.cipher';
import { PrismaMfaRepository } from './infrastructure/prisma-mfa.repository';

type Auth = ConfigType<typeof authenticationConfig>;

@Module({
  // forwardRef: AuthenticationModule needs the challenge store to gate login,
  // and the routes here need its CallerResolver to know whose methods they
  // are managing.
  imports: [forwardRef(() => AuthenticationModule)],
  controllers: [MfaController],
  providers: [
    {
      // Built once at boot: the constructor rejects a key that is not 32
      // bytes, so a misconfigured key fails the process rather than the first
      // enrolment — and never silently produces undecryptable secrets.
      provide: MfaSecretCipher,
      inject: [authenticationConfig.KEY],
      useFactory: (auth: Auth) => new MfaSecretCipher(auth.mfa.encryptionKey),
    },
    {
      provide: MfaChallengeStore,
      inject: [authenticationConfig.KEY],
      useFactory: (auth: Auth) =>
        new MemoryMfaChallengeStore(
          auth.lifetimes.mfaChallenge,
          auth.mfa.challengeMaxAttempts,
        ),
    },
    { provide: MfaRepository, useClass: PrismaMfaRepository },
    BeginMfaEnrollmentUseCase,
    ConfirmMfaEnrollmentUseCase,
    DisableMfaUseCase,
    RegenerateRecoveryCodesUseCase,
    VerifyMfaUseCase,
  ],
  exports: [
    MfaChallengeStore,
    MfaRepository,
    MfaSecretCipher,
    BeginMfaEnrollmentUseCase,
    ConfirmMfaEnrollmentUseCase,
    DisableMfaUseCase,
    RegenerateRecoveryCodesUseCase,
    VerifyMfaUseCase,
  ],
})
export class MfaModule {}
