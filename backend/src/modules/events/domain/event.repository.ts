import type { TenantContext } from '../../../common/types/tenant-context';
import type { EventStatus } from '../../../infrastructure/database/enums';

export interface EventProfile {
  readonly eventId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly status: string;
  readonly eventCode: string;
  readonly timezone: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly checkInOpensAt: Date | null;
  readonly checkInClosesAt: Date | null;
  readonly capacity: number | null;
  readonly locationName: string | null;
  readonly settings: Record<string, unknown>;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface EventValues {
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly timezone: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly checkInOpensAt: Date | null;
  readonly checkInClosesAt: Date | null;
  readonly capacity: number | null;
  readonly locationName: string | null;
  readonly settings: Record<string, unknown>;
}

export interface EventChanges {
  name?: string;
  slug?: string;
  description?: string | null;
  timezone?: string;
  startsAt?: Date;
  endsAt?: Date;
  checkInOpensAt?: Date | null;
  checkInClosesAt?: Date | null;
  capacity?: number | null;
  locationName?: string | null;
  settings?: Record<string, unknown>;
}

export interface EventAuditFacts {
  readonly actorRole: string | null;
  readonly requestId: string | null;
  readonly ipAddress: string | null;
}

export type EventCreateFailure = 'SLUG_TAKEN' | 'EVENT_CODE_COLLISION';

export type EventUpdateFailure =
  'NOT_FOUND' | 'CONFLICT' | 'SLUG_TAKEN' | 'INVALID_SCHEDULE';

export type EventTransitionFailure =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | { readonly kind: 'INVALID_TRANSITION'; readonly reason: string };

export abstract class EventRepository {
  abstract list(context: TenantContext): Promise<EventProfile[]>;

  abstract find(
    context: TenantContext,
    eventId: string,
  ): Promise<EventProfile | null>;

  abstract create(
    context: TenantContext,
    input: EventValues & {
      readonly eventId: string;
      readonly eventCode: string;
      readonly facts: EventAuditFacts;
    },
  ): Promise<EventProfile | EventCreateFailure>;

  abstract update(
    context: TenantContext,
    eventId: string,
    expectedVersion: number,
    changes: EventChanges,
    facts: EventAuditFacts,
  ): Promise<EventProfile | EventUpdateFailure>;

  abstract transition(
    context: TenantContext,
    eventId: string,
    expectedVersion: number,
    target: Extract<EventStatus, 'ACTIVE' | 'CANCELLED'>,
    cancellationReason: string | null,
    facts: EventAuditFacts,
  ): Promise<EventProfile | EventTransitionFailure>;
}
