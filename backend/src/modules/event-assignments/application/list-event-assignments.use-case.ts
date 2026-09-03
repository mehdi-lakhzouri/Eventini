import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import { EventAssignmentRepository } from '../domain/event-assignment.repository';

@Injectable()
export class ListEventAssignmentsUseCase {
  constructor(private readonly assignments: EventAssignmentRepository) {}

  execute(context: TenantContext, eventId: string) {
    return this.assignments.list(context, eventId);
  }
}
