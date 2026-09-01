import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import { EventRepository, type EventProfile } from '../domain/event.repository';

@Injectable()
export class GetEventUseCase {
  constructor(private readonly events: EventRepository) {}

  execute(
    context: TenantContext,
    eventId: string,
  ): Promise<EventProfile | null> {
    return this.events.find(context, eventId);
  }
}
