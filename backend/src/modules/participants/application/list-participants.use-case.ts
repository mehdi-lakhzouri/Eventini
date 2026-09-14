import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import {
  ParticipantRepository,
  type ParticipantListQuery,
  type ParticipantPage,
} from '../domain/participant.repository';

@Injectable()
export class ListParticipantsUseCase {
  constructor(private readonly participants: ParticipantRepository) {}

  execute(
    context: TenantContext,
    query: ParticipantListQuery,
  ): Promise<ParticipantPage> {
    return this.participants.list(context, query);
  }
}
