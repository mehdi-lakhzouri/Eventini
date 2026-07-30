import { Module } from '@nestjs/common';
import { BeginMfaEnrollmentUseCase } from './application/begin-mfa-enrollment.use-case';
import { ConfirmMfaEnrollmentUseCase } from './application/confirm-mfa-enrollment.use-case';
import { DisableMfaUseCase } from './application/disable-mfa.use-case';
import { RegenerateRecoveryCodesUseCase } from './application/regenerate-recovery-codes.use-case';
import { VerifyMfaUseCase } from './application/verify-mfa.use-case';

@Module({
  providers: [
    BeginMfaEnrollmentUseCase,
    ConfirmMfaEnrollmentUseCase,
    DisableMfaUseCase,
    RegenerateRecoveryCodesUseCase,
    VerifyMfaUseCase,
  ],
  exports: [
    BeginMfaEnrollmentUseCase,
    ConfirmMfaEnrollmentUseCase,
    DisableMfaUseCase,
    RegenerateRecoveryCodesUseCase,
    VerifyMfaUseCase,
  ],
})
export class MfaModule {}
