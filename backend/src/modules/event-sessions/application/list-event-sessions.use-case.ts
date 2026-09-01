import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import { EventSessionRepository } from '../domain/event-session.repository';

@Injectable()
export class ListEventSessionsUseCase {
  constructor(private readonly sessions: EventSessionRepository) {}

  execute(context: TenantContext, eventId: string) {
    return this.sessions.list(context, eventId);
  }
}
