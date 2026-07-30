import { Module } from '@nestjs/common';
import { MfaModule } from '../mfa';
import { PasswordsModule } from '../passwords';
import { SecurityEventsModule } from '../security-events';
import { IdentitySessionsModule } from '../sessions';
import { AuthenticationController } from './controllers/authentication.controller';
import { GetCurrentUserUseCase } from './application/get-current-user.use-case';
import { LoginUseCase } from './application/login.use-case';
import { LogoutUseCase } from './application/logout.use-case';
import { RefreshSessionUseCase } from './application/refresh-session.use-case';

@Module({
  imports: [IdentitySessionsModule, PasswordsModule, MfaModule, SecurityEventsModule],
  controllers: [AuthenticationController],
  providers: [
    GetCurrentUserUseCase,
    LoginUseCase,
    LogoutUseCase,
    RefreshSessionUseCase,
  ],
})
export class AuthenticationModule {}
