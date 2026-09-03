import type { AuditRequestFacts } from '../../audit';
import type { TenantContext } from '../../../common/types/tenant-context';
import type { EventAssignmentType } from '../../../infrastructure/database/enums';

export interface EventAssignmentProfile {
  readonly assignmentId: string;
  readonly organizationId: string;
  readonly eventId: string;
  readonly membershipId: string;
  readonly assignmentType: EventAssignmentType;
  readonly status: string;
  readonly validFrom: Date | null;
  readonly validUntil: Date | null;
  readonly assignedAt: Date;
  readonly assignedBy: string | null;
  readonly revokedAt: Date | null;
  readonly revokedBy: string | null;
}

export type EventAssignmentRefusal =
  | 'EVENT_NOT_FOUND'
  | 'MEMBERSHIP_NOT_FOUND'
  | 'ALREADY_ASSIGNED'
  | 'NOT_FOUND';

export abstract class EventAssignmentRepository {
  abstract list(
    context: TenantContext,
    eventId: string,
  ): Promise<EventAssignmentProfile[] | 'EVENT_NOT_FOUND'>;

  abstract assign(
    context: TenantContext,
    input: {
      readonly eventId: string;
      readonly membershipId: string;
      readonly assignmentType: EventAssignmentType;
      readonly validFrom: Date | null;
      readonly validUntil: Date | null;
      readonly facts: AuditRequestFacts;
    },
  ): Promise<EventAssignmentProfile | EventAssignmentRefusal>;

  abstract revoke(
    context: TenantContext,
    input: {
      readonly eventId: string;
      readonly assignmentId: string;
      readonly facts: AuditRequestFacts;
    },
  ): Promise<EventAssignmentProfile | 'NOT_FOUND'>;
}
