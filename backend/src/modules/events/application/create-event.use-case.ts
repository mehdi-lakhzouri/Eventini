import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import {
  ID_PREFIXES,
  newId,
} from '../../../infrastructure/database/identifiers';
import { generateEventCode } from '../domain/event-code';
import {
  EventRepository,
  type EventAuditFacts,
  type EventProfile,
  type EventValues,
} from '../domain/event.repository';
import { isValidEventSchedule } from '../domain/event-schedule';

const MAX_EVENT_CODE_ATTEMPTS = 5;

export type CreateEventRefusal = 'INVALID_SCHEDULE' | 'SLUG_TAKEN';

@Injectable()
export class CreateEventUseCase {
  constructor(private readonly events: EventRepository) {}

  async execute(input: {
    context: TenantContext;
    values: EventValues;
    facts: EventAuditFacts;
  }): Promise<EventProfile | CreateEventRefusal> {
    if (!isValidEventSchedule(input.values)) {
      return 'INVALID_SCHEDULE';
    }

    const eventId = newId(ID_PREFIXES.event);

    for (let attempt = 0; attempt < MAX_EVENT_CODE_ATTEMPTS; attempt += 1) {
      const result = await this.events.create(input.context, {
        ...input.values,
        eventId,
        eventCode: generateEventCode(),
        facts: input.facts,
      });

      if (result === 'SLUG_TAKEN') {
        return result;
      }

      if (result !== 'EVENT_CODE_COLLISION') {
        return result;
      }
    }

    throw new Error(
      'Unable to allocate a globally unique event code after repeated collisions.',
    );
  }
}
