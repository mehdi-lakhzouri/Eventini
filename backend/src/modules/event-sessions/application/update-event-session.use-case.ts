import { Injectable } from '@nestjs/common';

import type { AuditRequestFacts } from '../../audit';
import type { TenantContext } from '../../../common/types/tenant-context';
import {
  EventSessionRepository,
  type EventSessionChanges,
  type EventSessionProfile,
  type EventSessionUpdateFailure,
} from '../domain/event-session.repository';

export type UpdateEventSessionRefusal =
  EventSessionUpdateFailure | 'NO_CHANGES';

@Injectable()
export class UpdateEventSessionUseCase {
  constructor(private readonly sessions: EventSessionRepository) {}

  execute(input: {
    context: TenantContext;
    eventId: string;
    sessionId: string;
    expectedVersion: number;
    changes: EventSessionChanges;
    facts: AuditRequestFacts;
  }): Promise<EventSessionProfile | UpdateEventSessionRefusal> {
    if (Object.keys(input.changes).length === 0) {
      return Promise.resolve('NO_CHANGES');
    }

    return this.sessions.update(
      input.context,
      input.eventId,
      input.sessionId,
      input.expectedVersion,
      input.changes,
      input.facts,
    );
  }
}
