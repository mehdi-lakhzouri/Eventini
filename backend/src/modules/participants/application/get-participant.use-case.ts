import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import {
  ParticipantRepository,
  type ParticipantDetail,
} from '../domain/participant.repository';

@Injectable()
export class GetParticipantUseCase {
  constructor(private readonly participants: ParticipantRepository) {}

  execute(
    context: TenantContext,
    participantId: string,
  ): Promise<ParticipantDetail | null> {
    return this.participants.find(context, participantId);
  }
}
