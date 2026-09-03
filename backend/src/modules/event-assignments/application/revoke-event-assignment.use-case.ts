import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import type { AuditRequestFacts } from '../../audit';
import { EventAssignmentRepository } from '../domain/event-assignment.repository';

@Injectable()
export class RevokeEventAssignmentUseCase {
  constructor(private readonly assignments: EventAssignmentRepository) {}

  execute(input: {
    context: TenantContext;
    eventId: string;
    assignmentId: string;
    facts: AuditRequestFacts;
  }) {
    return this.assignments.revoke(input.context, input);
  }
}
