import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import type { EventStatus } from '../../../infrastructure/database/enums';
import {
  EventRepository,
  type EventAuditFacts,
  type EventProfile,
  type EventTransitionFailure,
} from '../domain/event.repository';

@Injectable()
export class TransitionEventUseCase {
  constructor(private readonly events: EventRepository) {}

  execute(input: {
    context: TenantContext;
    eventId: string;
    expectedVersion: number;
    target: Extract<EventStatus, 'ACTIVE' | 'CANCELLED'>;
    cancellationReason: string | null;
    facts: EventAuditFacts;
  }): Promise<EventProfile | EventTransitionFailure> {
    return this.events.transition(
      input.context,
      input.eventId,
      input.expectedVersion,
      input.target,
      input.cancellationReason,
      input.facts,
    );
  }
}
