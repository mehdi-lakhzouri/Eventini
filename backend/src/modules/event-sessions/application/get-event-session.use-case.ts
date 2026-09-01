import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import { EventSessionRepository } from '../domain/event-session.repository';

@Injectable()
export class GetEventSessionUseCase {
  constructor(private readonly sessions: EventSessionRepository) {}

  execute(context: TenantContext, eventId: string, sessionId: string) {
    return this.sessions.find(context, eventId, sessionId);
  }
}
