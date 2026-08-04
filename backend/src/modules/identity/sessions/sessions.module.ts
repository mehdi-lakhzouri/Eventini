import { Module } from '@nestjs/common';

import { SessionRepository } from './domain/session.repository';
import { PrismaSessionRepository } from './infrastructure/prisma-session.repository';
import { CreateSessionUseCase } from './application/create-session.use-case';
import { ListUserSessionsUseCase } from './application/list-user-sessions.use-case';
import { RevokeAllSessionsUseCase } from './application/revoke-all-sessions.use-case';
import { RevokeSessionUseCase } from './application/revoke-session.use-case';
import { RotateSessionUseCase } from './application/rotate-session.use-case';

@Module({
  providers: [
    { provide: SessionRepository, useClass: PrismaSessionRepository },
    CreateSessionUseCase,
    ListUserSessionsUseCase,
    RevokeAllSessionsUseCase,
    RevokeSessionUseCase,
    RotateSessionUseCase,
  ],
  exports: [
    SessionRepository,
    CreateSessionUseCase,
    ListUserSessionsUseCase,
    RevokeAllSessionsUseCase,
    RevokeSessionUseCase,
    RotateSessionUseCase,
  ],
})
export class IdentitySessionsModule {}
