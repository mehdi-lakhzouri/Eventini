import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import {
  ID_PREFIXES,
  newId,
} from '../../../infrastructure/database/identifiers';
import {
  ParticipantRepository,
  type ParticipantAuditFacts,
  type ParticipantCreateFailure,
  type ParticipantDetail,
  type ParticipantValues,
} from '../domain/participant.repository';
import {
  cleanParticipantValues,
  isMetadataWithinLimit,
} from '../domain/participant-values';

export type CreateParticipantRefusal =
  ParticipantCreateFailure | 'METADATA_TOO_LARGE';

/**
 * A probable duplicate does not refuse the creation. The fingerprint only
 * signals — the response carries `possibleDuplicateIds` for a human to act
 * on, and nothing is merged (sprint-10 EVT-054).
 */
@Injectable()
export class CreateParticipantUseCase {
  constructor(private readonly participants: ParticipantRepository) {}

  async execute(input: {
    context: TenantContext;
    values: ParticipantValues;
    facts: ParticipantAuditFacts;
  }): Promise<ParticipantDetail | CreateParticipantRefusal> {
    if (!isMetadataWithinLimit(input.values.metadata)) {
      return 'METADATA_TOO_LARGE';
    }

    return this.participants.create(input.context, {
      ...cleanParticipantValues(input.values),
      participantId: newId(ID_PREFIXES.participant),
      facts: input.facts,
    });
  }
}
