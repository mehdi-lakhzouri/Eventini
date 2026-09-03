import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import type { EventAssignmentType } from '../../../infrastructure/database/enums';
import type { AuditRequestFacts } from '../../audit';
import { EventAssignmentRepository } from '../domain/event-assignment.repository';

@Injectable()
export class AssignEventUserUseCase {
  constructor(private readonly assignments: EventAssignmentRepository) {}

  execute(input: {
    context: TenantContext;
    eventId: string;
    membershipId: string;
    assignmentType: EventAssignmentType;
    validFrom: Date | null;
    validUntil: Date | null;
    facts: AuditRequestFacts;
  }) {
    return this.assignments.assign(input.context, input);
  }
}
