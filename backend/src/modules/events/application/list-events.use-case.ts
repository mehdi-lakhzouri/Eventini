import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import { EventRepository, type EventProfile } from '../domain/event.repository';

@Injectable()
export class ListEventsUseCase {
  constructor(private readonly events: EventRepository) {}

  execute(context: TenantContext): Promise<EventProfile[]> {
    return this.events.list(context);
  }
}
