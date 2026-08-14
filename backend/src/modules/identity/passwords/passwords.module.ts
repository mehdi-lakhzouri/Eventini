import { Module, forwardRef } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { authenticationConfig } from '../../../config/authentication.config';
import { AuthenticationModule } from '../authentication/authentication.module';
import { IdentitySessionsModule } from '../sessions';
import { ChangePasswordUseCase } from './application/change-password.use-case';
import { RequestPasswordResetUseCase } from './application/request-password-reset.use-case';
import { ResetPasswordUseCase } from './application/reset-password.use-case';
import { PasswordsController } from './controllers/passwords.controller';
import { PasswordHasher } from './domain/password-hasher';
import { PasswordResetTokenRepository } from './domain/password-reset-token.repository';
import { ArgonPasswordHasher } from './infrastructure/argon-password-hasher';
import { PrismaPasswordResetTokenRepository } from './infrastructure/prisma-password-reset-token.repository';
import { PASSWORD_LIMITS } from './password.tokens';

@Module({
  // forwardRef: AuthenticationModule needs the hasher for login, and the
  // password endpoints need its CallerResolver to identify who is changing
  // their own password.
  imports: [IdentitySessionsModule, forwardRef(() => AuthenticationModule)],
  controllers: [PasswordsController],
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
    {
      provide: PasswordResetTokenRepository,
      useClass: PrismaPasswordResetTokenRepository,
    },
    ChangePasswordUseCase,
    RequestPasswordResetUseCase,
    ResetPasswordUseCase,
  ],
  exports: [
    PasswordHasher,
    PASSWORD_LIMITS,
    PasswordResetTokenRepository,
    ChangePasswordUseCase,
    RequestPasswordResetUseCase,
    ResetPasswordUseCase,
  ],
})
export class PasswordsModule {}
