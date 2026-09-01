import { Injectable } from '@nestjs/common';

import type { AuditRequestFacts } from '../../audit';
import type { TenantContext } from '../../../common/types/tenant-context';
import type { EventSessionStatus } from '../../../infrastructure/database/enums';
import {
  EventSessionRepository,
  type EventSessionProfile,
  type EventSessionTransitionFailure,
} from '../domain/event-session.repository';

@Injectable()
export class TransitionEventSessionUseCase {
  constructor(private readonly sessions: EventSessionRepository) {}

  execute(input: {
    context: TenantContext;
    eventId: string;
    sessionId: string;
    expectedVersion: number;
    targetStatus: EventSessionStatus;
    facts: AuditRequestFacts;
  }): Promise<EventSessionProfile | EventSessionTransitionFailure> {
    return this.sessions.transition(
      input.context,
      input.eventId,
      input.sessionId,
      input.expectedVersion,
      input.targetStatus,
      input.facts,
    );
  }
}
