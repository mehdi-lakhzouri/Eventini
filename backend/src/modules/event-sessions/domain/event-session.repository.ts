import type { AuditRequestFacts } from '../../audit';
import type { TenantContext } from '../../../common/types/tenant-context';
import type { EventSessionStatus } from '../../../infrastructure/database/enums';

export interface EventSessionProfile {
  readonly sessionId: string;
  readonly organizationId: string;
  readonly eventId: string;
  readonly name: string;
  readonly sessionType: string;
  readonly status: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly checkInOpensAt: Date | null;
  readonly checkInClosesAt: Date | null;
  readonly capacity: number | null;
  readonly locationName: string | null;
  readonly requiresSeparateCheckIn: boolean;
  readonly openedAt: Date | null;
  readonly openedBy: string | null;
  readonly closedAt: Date | null;
  readonly closedBy: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface EventSessionValues {
  readonly name: string;
  readonly sessionType: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly checkInOpensAt: Date | null;
  readonly checkInClosesAt: Date | null;
  readonly capacity: number | null;
  readonly locationName: string | null;
  readonly requiresSeparateCheckIn: boolean;
}

export interface EventSessionChanges {
  name?: string;
  sessionType?: string;
  startsAt?: Date;
  endsAt?: Date;
  checkInOpensAt?: Date | null;
  checkInClosesAt?: Date | null;
  capacity?: number | null;
  locationName?: string | null;
  requiresSeparateCheckIn?: boolean;
}

export type EventSessionCreateFailure = 'EVENT_NOT_FOUND';
export type EventSessionUpdateFailure =
  'NOT_FOUND' | 'CONFLICT' | 'INVALID_SCHEDULE';
export type EventSessionTransitionFailure =
  'NOT_FOUND' | 'CONFLICT' | 'INVALID_STATE_TRANSITION';

export abstract class EventSessionRepository {
  abstract list(
    context: TenantContext,
    eventId: string,
  ): Promise<EventSessionProfile[] | EventSessionCreateFailure>;

  abstract find(
    context: TenantContext,
    eventId: string,
    sessionId: string,
  ): Promise<EventSessionProfile | null>;

  abstract create(
    context: TenantContext,
    eventId: string,
    input: EventSessionValues & {
      readonly sessionId: string;
      readonly facts: AuditRequestFacts;
    },
  ): Promise<EventSessionProfile | EventSessionCreateFailure>;

  abstract update(
    context: TenantContext,
    eventId: string,
    sessionId: string,
    expectedVersion: number,
    changes: EventSessionChanges,
    facts: AuditRequestFacts,
  ): Promise<EventSessionProfile | EventSessionUpdateFailure>;

  abstract transition(
    context: TenantContext,
    eventId: string,
    sessionId: string,
    expectedVersion: number,
    targetStatus: EventSessionStatus,
    facts: AuditRequestFacts,
  ): Promise<EventSessionProfile | EventSessionTransitionFailure>;
}
