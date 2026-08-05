import { Module } from '@nestjs/common';

import { RevocationRepository } from './domain/revocation.repository';
import { RotationRepository } from './domain/rotation.repository';
import { SessionRepository } from './domain/session.repository';
import { PrismaRevocationRepository } from './infrastructure/prisma-revocation.repository';
import { PrismaRotationRepository } from './infrastructure/prisma-rotation.repository';
import { PrismaSessionRepository } from './infrastructure/prisma-session.repository';
import { CreateSessionUseCase } from './application/create-session.use-case';
import { ListUserSessionsUseCase } from './application/list-user-sessions.use-case';
import { RevokeAllSessionsUseCase } from './application/revoke-all-sessions.use-case';
import { RevokeSessionUseCase } from './application/revoke-session.use-case';
import { RotateSessionUseCase } from './application/rotate-session.use-case';

@Module({
  providers: [
    { provide: SessionRepository, useClass: PrismaSessionRepository },
    { provide: RotationRepository, useClass: PrismaRotationRepository },
    { provide: RevocationRepository, useClass: PrismaRevocationRepository },
    CreateSessionUseCase,
    ListUserSessionsUseCase,
    RevokeAllSessionsUseCase,
    RevokeSessionUseCase,
    RotateSessionUseCase,
  ],
  exports: [
    SessionRepository,
    RotationRepository,
    RevocationRepository,
    CreateSessionUseCase,
    ListUserSessionsUseCase,
    RevokeAllSessionsUseCase,
    RevokeSessionUseCase,
    RotateSessionUseCase,
  ],
})
export class IdentitySessionsModule {}
