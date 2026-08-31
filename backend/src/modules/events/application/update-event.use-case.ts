import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import {
  EventRepository,
  type EventAuditFacts,
  type EventChanges,
  type EventProfile,
  type EventUpdateFailure,
} from '../domain/event.repository';

export type UpdateEventRefusal = EventUpdateFailure | 'NO_CHANGES';

@Injectable()
export class UpdateEventUseCase {
  constructor(private readonly events: EventRepository) {}

  execute(input: {
    context: TenantContext;
    eventId: string;
    expectedVersion: number;
    changes: EventChanges;
    facts: EventAuditFacts;
  }): Promise<EventProfile | UpdateEventRefusal> {
    if (Object.keys(input.changes).length === 0) {
      return Promise.resolve('NO_CHANGES');
    }

    return this.events.update(
      input.context,
      input.eventId,
      input.expectedVersion,
      input.changes,
      input.facts,
    );
  }
}
