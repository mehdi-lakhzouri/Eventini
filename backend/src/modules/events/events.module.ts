import { Module } from '@nestjs/common';

import { AuditModule } from '../audit';
import { AuthorizationModule } from '../identity';
import { CreateEventUseCase } from './application/create-event.use-case';
import { GetEventUseCase } from './application/get-event.use-case';
import { ListEventsUseCase } from './application/list-events.use-case';
import { UpdateEventUseCase } from './application/update-event.use-case';
import { EventsController } from './controllers/events.controller';
import { EventRepository } from './domain/event.repository';
import { PrismaEventRepository } from './infrastructure/prisma-event.repository';

@Module({
  imports: [AuditModule, AuthorizationModule],
  controllers: [EventsController],
  providers: [
    { provide: EventRepository, useClass: PrismaEventRepository },
    ListEventsUseCase,
    GetEventUseCase,
    CreateEventUseCase,
    UpdateEventUseCase,
  ],
  exports: [EventRepository],
})
export class EventsModule {}
