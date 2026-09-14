import { Module } from '@nestjs/common';

import { PaginationModule } from '../../common/api/pagination';
import { AuditModule } from '../audit';
import { AuthorizationModule } from '../identity';
import { CreateParticipantUseCase } from './application/create-participant.use-case';
import { DeleteParticipantUseCase } from './application/delete-participant.use-case';
import { GetParticipantUseCase } from './application/get-participant.use-case';
import { ListParticipantsUseCase } from './application/list-participants.use-case';
import { UpdateParticipantUseCase } from './application/update-participant.use-case';
import { ParticipantsController } from './controllers/participants.controller';
import { ParticipantRepository } from './domain/participant.repository';
import { PrismaParticipantRepository } from './infrastructure/prisma-participant.repository';

@Module({
  imports: [AuditModule, AuthorizationModule, PaginationModule],
  controllers: [ParticipantsController],
  providers: [
    { provide: ParticipantRepository, useClass: PrismaParticipantRepository },
    ListParticipantsUseCase,
    GetParticipantUseCase,
    CreateParticipantUseCase,
    UpdateParticipantUseCase,
    DeleteParticipantUseCase,
  ],
  exports: [ParticipantRepository],
})
export class ParticipantsModule {}
