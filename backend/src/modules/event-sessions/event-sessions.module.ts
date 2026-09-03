import { Module } from '@nestjs/common';

import { AuditModule } from '../audit';
import { AuthorizationModule } from '../identity';
import { CreateEventSessionUseCase } from './application/create-event-session.use-case';
import { GetEventSessionUseCase } from './application/get-event-session.use-case';
import { ListEventSessionsUseCase } from './application/list-event-sessions.use-case';
import { TransitionEventSessionUseCase } from './application/transition-event-session.use-case';
import { UpdateEventSessionUseCase } from './application/update-event-session.use-case';
import { EventSessionsController } from './controllers/event-sessions.controller';
import { EventSessionRepository } from './domain/event-session.repository';
import { PrismaEventSessionRepository } from './infrastructure/prisma-event-session.repository';

@Module({
  imports: [AuditModule, AuthorizationModule],
  controllers: [EventSessionsController],
  providers: [
    { provide: EventSessionRepository, useClass: PrismaEventSessionRepository },
    ListEventSessionsUseCase,
    GetEventSessionUseCase,
    CreateEventSessionUseCase,
    UpdateEventSessionUseCase,
    TransitionEventSessionUseCase,
  ],
  exports: [EventSessionRepository],
})
export class EventSessionsModule {}
