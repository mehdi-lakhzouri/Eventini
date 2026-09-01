import { Injectable } from '@nestjs/common';

import type { AuditRequestFacts } from '../../audit';
import type { TenantContext } from '../../../common/types/tenant-context';
import {
  ID_PREFIXES,
  newId,
} from '../../../infrastructure/database/identifiers';
import { isValidEventSessionSchedule } from '../domain/event-session-schedule';
import {
  EventSessionRepository,
  type EventSessionCreateFailure,
  type EventSessionProfile,
  type EventSessionValues,
} from '../domain/event-session.repository';

export type CreateEventSessionRefusal =
  EventSessionCreateFailure | 'INVALID_SCHEDULE';

@Injectable()
export class CreateEventSessionUseCase {
  constructor(private readonly sessions: EventSessionRepository) {}

  execute(input: {
    context: TenantContext;
    eventId: string;
    values: EventSessionValues;
    facts: AuditRequestFacts;
  }): Promise<EventSessionProfile | CreateEventSessionRefusal> {
    if (!isValidEventSessionSchedule(input.values)) {
      return Promise.resolve('INVALID_SCHEDULE');
    }

    return this.sessions.create(input.context, input.eventId, {
      ...input.values,
      sessionId: newId(ID_PREFIXES.eventSession),
      facts: input.facts,
    });
  }
}
