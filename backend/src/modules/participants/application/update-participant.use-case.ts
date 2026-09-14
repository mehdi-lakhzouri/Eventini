import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import {
  ParticipantRepository,
  type ParticipantAuditFacts,
  type ParticipantChanges,
  type ParticipantDetail,
  type ParticipantUpdateFailure,
} from '../domain/participant.repository';
import {
  cleanParticipantChanges,
  isMetadataWithinLimit,
} from '../domain/participant-values';

export type UpdateParticipantRefusal =
  ParticipantUpdateFailure | 'NO_CHANGES' | 'METADATA_TOO_LARGE';

@Injectable()
export class UpdateParticipantUseCase {
  constructor(private readonly participants: ParticipantRepository) {}

  async execute(input: {
    context: TenantContext;
    participantId: string;
    expectedVersion: number;
    changes: ParticipantChanges;
    facts: ParticipantAuditFacts;
  }): Promise<ParticipantDetail | UpdateParticipantRefusal> {
    if (Object.keys(input.changes).length === 0) {
      return 'NO_CHANGES';
    }

    if (
      input.changes.metadata !== undefined &&
      !isMetadataWithinLimit(input.changes.metadata)
    ) {
      return 'METADATA_TOO_LARGE';
    }

    return this.participants.update(
      input.context,
      input.participantId,
      input.expectedVersion,
      cleanParticipantChanges(input.changes),
      input.facts,
    );
  }
}
