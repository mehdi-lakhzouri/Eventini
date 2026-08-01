import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { authenticationConfig } from '../../../config/authentication.config';
import { ChangePasswordUseCase } from './application/change-password.use-case';
import { RequestPasswordResetUseCase } from './application/request-password-reset.use-case';
import { ResetPasswordUseCase } from './application/reset-password.use-case';
import { PasswordHasher } from './domain/password-hasher';
import { PASSWORD_LIMITS } from './password.tokens';
import { ArgonPasswordHasher } from './infrastructure/argon-password-hasher';

@Module({
  providers: [
    {
      provide: PasswordHasher,
      inject: [authenticationConfig.KEY],
      useFactory: (auth: ConfigType<typeof authenticationConfig>) =>
        new ArgonPasswordHasher(auth.argon2),
    },
    {
      provide: PASSWORD_LIMITS,
      inject: [authenticationConfig.KEY],
      useFactory: (auth: ConfigType<typeof authenticationConfig>) =>
        auth.password,
    },
    ChangePasswordUseCase,
    RequestPasswordResetUseCase,
    ResetPasswordUseCase,
  ],
  exports: [
    PasswordHasher,
    PASSWORD_LIMITS,
    ChangePasswordUseCase,
    RequestPasswordResetUseCase,
    ResetPasswordUseCase,
  ],
})
export class PasswordsModule {}
