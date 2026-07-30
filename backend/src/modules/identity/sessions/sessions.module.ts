import { Module } from '@nestjs/common';
import { CreateSessionUseCase } from './application/create-session.use-case';
import { ListUserSessionsUseCase } from './application/list-user-sessions.use-case';
import { RevokeAllSessionsUseCase } from './application/revoke-all-sessions.use-case';
import { RevokeSessionUseCase } from './application/revoke-session.use-case';
import { RotateSessionUseCase } from './application/rotate-session.use-case';

@Module({
  providers: [
    CreateSessionUseCase,
    ListUserSessionsUseCase,
    RevokeAllSessionsUseCase,
    RevokeSessionUseCase,
    RotateSessionUseCase,
  ],
  exports: [
    CreateSessionUseCase,
    ListUserSessionsUseCase,
    RevokeAllSessionsUseCase,
    RevokeSessionUseCase,
    RotateSessionUseCase,
  ],
})
export class IdentitySessionsModule {}
