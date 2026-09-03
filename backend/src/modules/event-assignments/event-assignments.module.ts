import { Module } from '@nestjs/common';

import { AuditModule } from '../audit';
import { AuthorizationModule } from '../identity';
import { AssignEventUserUseCase } from './application/assign-event-user.use-case';
import { ListEventAssignmentsUseCase } from './application/list-event-assignments.use-case';
import { RevokeEventAssignmentUseCase } from './application/revoke-event-assignment.use-case';
import { EventAssignmentsController } from './controllers/event-assignments.controller';
import { EventAssignmentRepository } from './domain/event-assignment.repository';
import { PrismaEventAssignmentRepository } from './infrastructure/prisma-event-assignment.repository';

@Module({
  imports: [AuditModule, AuthorizationModule],
  controllers: [EventAssignmentsController],
  providers: [
    { provide: EventAssignmentRepository, useClass: PrismaEventAssignmentRepository },
    ListEventAssignmentsUseCase, AssignEventUserUseCase, RevokeEventAssignmentUseCase,
  ],
})
export class EventAssignmentsModule {}
