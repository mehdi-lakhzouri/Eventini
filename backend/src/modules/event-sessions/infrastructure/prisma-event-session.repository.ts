import { Inject, Injectable } from '@nestjs/common';

import type { AuditRequestFacts } from '../../audit';
import { AuditRecorder } from '../../audit';
import type { TenantContext } from '../../../common/types/tenant-context';
import type { EventSessionStatus } from '../../../infrastructure/database/enums';
import { TENANT_SCOPED_PRISMA } from '../../../infrastructure/database/prisma.tokens';
import type { TenantScopedPrismaClient } from '../../../infrastructure/database/tenant-scope.extension';
import { isValidEventSessionSchedule } from '../domain/event-session-schedule';
import { canTransitionEventSession } from '../domain/event-session-transitions';
import {
  EventSessionRepository,
  type EventSessionChanges,
  type EventSessionCreateFailure,
  type EventSessionProfile,
  type EventSessionTransitionFailure,
  type EventSessionUpdateFailure,
  type EventSessionValues,
} from '../domain/event-session.repository';

const SESSION_SELECT = {
  id: true,
  organizationId: true,
  eventId: true,
  name: true,
  sessionType: true,
  status: true,
  startsAt: true,
  endsAt: true,
  checkInOpensAt: true,
  checkInClosesAt: true,
  capacity: true,
  locationName: true,
  requiresSeparateCheckIn: true,
  openedAt: true,
  openedBy: true,
  closedAt: true,
  closedBy: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;

type SessionRow = {
  id: string;
  organizationId: string;
  eventId: string;
  name: string;
  sessionType: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  checkInOpensAt: Date | null;
  checkInClosesAt: Date | null;
  capacity: number | null;
  locationName: string | null;
  requiresSeparateCheckIn: boolean;
  openedAt: Date | null;
  openedBy: string | null;
  closedAt: Date | null;
  closedBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

const toProfile = (row: SessionRow): EventSessionProfile => ({
  sessionId: row.id,
  organizationId: row.organizationId,
  eventId: row.eventId,
  name: row.name,
  sessionType: row.sessionType,
  status: row.status,
  startsAt: row.startsAt,
  endsAt: row.endsAt,
  checkInOpensAt: row.checkInOpensAt,
  checkInClosesAt: row.checkInClosesAt,
  capacity: row.capacity,
  locationName: row.locationName,
  requiresSeparateCheckIn: row.requiresSeparateCheckIn,
  openedAt: row.openedAt,
  openedBy: row.openedBy,
  closedAt: row.closedAt,
  closedBy: row.closedBy,
  version: row.version,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

@Injectable()
export class PrismaEventSessionRepository extends EventSessionRepository {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA)
    private readonly prisma: TenantScopedPrismaClient,
    private readonly audit: AuditRecorder,
  ) {
    super();
  }

  async list(context: TenantContext, eventId: string) {
    if (!(await this.eventExists(context, eventId))) {
      return 'EVENT_NOT_FOUND' as const;
    }

    const rows = await this.prisma.eventSession.findMany({
      where: {
        organizationId: context.organizationId,
        eventId,
        deletedAt: null,
      },
      select: SESSION_SELECT,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });

    return rows.map(toProfile);
  }

  async find(context: TenantContext, eventId: string, sessionId: string) {
    const row = await this.prisma.eventSession.findFirst({
      where: {
        id: sessionId,
        organizationId: context.organizationId,
        eventId,
        deletedAt: null,
      },
      select: SESSION_SELECT,
    });

    return row === null ? null : toProfile(row);
  }

  async create(
    context: TenantContext,
    eventId: string,
    input: EventSessionValues & {
      readonly sessionId: string;
      readonly facts: AuditRequestFacts;
    },
  ): Promise<EventSessionProfile | EventSessionCreateFailure> {
    return this.prisma.$transaction(async (tx) => {
      const event = await tx.event.findFirst({
        where: {
          id: eventId,
          organizationId: context.organizationId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (event === null) return 'EVENT_NOT_FOUND';

      const row = await tx.eventSession.create({
        data: {
          id: input.sessionId,
          organizationId: context.organizationId,
          eventId,
          name: input.name,
          sessionType: input.sessionType,
          status: 'SCHEDULED',
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          checkInOpensAt: input.checkInOpensAt,
          checkInClosesAt: input.checkInClosesAt,
          capacity: input.capacity,
          locationName: input.locationName,
          requiresSeparateCheckIn: input.requiresSeparateCheckIn,
          createdBy: context.userId,
          updatedBy: context.userId,
        },
        select: SESSION_SELECT,
      });
      const created = toProfile(row);

      await this.audit.record(
        tx,
        context,
        {
          action: 'event_session.created',
          targetType: 'event_session',
          targetId: row.id,
          newValues: auditValues(created),
        },
        input.facts,
      );
      return created;
    });
  }

  async update(
    context: TenantContext,
    eventId: string,
    sessionId: string,
    expectedVersion: number,
    changes: EventSessionChanges,
    facts: AuditRequestFacts,
  ): Promise<EventSessionProfile | EventSessionUpdateFailure> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.eventSession.findFirst({
        where: {
          id: sessionId,
          organizationId: context.organizationId,
          eventId,
          deletedAt: null,
        },
        select: SESSION_SELECT,
      });
      if (row === null) return 'NOT_FOUND';
      if (row.version !== expectedVersion) return 'CONFLICT';

      const current = toProfile(row);
      if (
        !isValidEventSessionSchedule({
          startsAt: changes.startsAt ?? current.startsAt,
          endsAt: changes.endsAt ?? current.endsAt,
          checkInOpensAt:
            changes.checkInOpensAt === undefined
              ? current.checkInOpensAt
              : changes.checkInOpensAt,
          checkInClosesAt:
            changes.checkInClosesAt === undefined
              ? current.checkInClosesAt
              : changes.checkInClosesAt,
        })
      ) {
        return 'INVALID_SCHEDULE';
      }

      const affected = await tx.eventSession.updateMany({
        where: {
          id: sessionId,
          organizationId: context.organizationId,
          eventId,
          version: expectedVersion,
          deletedAt: null,
        },
        data: {
          ...changes,
          version: { increment: 1 },
          updatedBy: context.userId,
        },
      });
      if (affected.count === 0) return 'CONFLICT';

      const updatedRow = await tx.eventSession.findFirst({
        where: {
          id: sessionId,
          organizationId: context.organizationId,
          eventId,
          deletedAt: null,
        },
        select: SESSION_SELECT,
      });
      if (updatedRow === null) return 'NOT_FOUND';

      const updated = toProfile(updatedRow);
      await this.audit.record(
        tx,
        context,
        {
          action: 'event_session.updated',
          targetType: 'event_session',
          targetId: sessionId,
          previousValues: changedAuditValues(current, changes),
          newValues: changedAuditValues(updated, changes),
        },
        facts,
      );
      return updated;
    });
  }

  async transition(
    context: TenantContext,
    eventId: string,
    sessionId: string,
    expectedVersion: number,
    targetStatus: EventSessionStatus,
    facts: AuditRequestFacts,
  ): Promise<EventSessionProfile | EventSessionTransitionFailure> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.eventSession.findFirst({
        where: {
          id: sessionId,
          organizationId: context.organizationId,
          eventId,
          deletedAt: null,
        },
        select: SESSION_SELECT,
      });
      if (row === null) return 'NOT_FOUND';
      if (row.version !== expectedVersion) return 'CONFLICT';

      const currentStatus = row.status as EventSessionStatus;
      if (!canTransitionEventSession(currentStatus, targetStatus)) {
        return 'INVALID_STATE_TRANSITION';
      }

      const changedAt = new Date();
      const affected = await tx.eventSession.updateMany({
        where: {
          id: sessionId,
          organizationId: context.organizationId,
          eventId,
          status: currentStatus,
          version: expectedVersion,
          deletedAt: null,
        },
        data: {
          status: targetStatus,
          ...(targetStatus === 'OPEN'
            ? { openedAt: changedAt, openedBy: context.userId }
            : { closedAt: changedAt, closedBy: context.userId }),
          version: { increment: 1 },
          updatedBy: context.userId,
        },
      });
      if (affected.count === 0) return 'CONFLICT';

      const updatedRow = await tx.eventSession.findFirst({
        where: {
          id: sessionId,
          organizationId: context.organizationId,
          eventId,
          deletedAt: null,
        },
        select: SESSION_SELECT,
      });
      if (updatedRow === null) return 'NOT_FOUND';

      const updated = toProfile(updatedRow);
      await this.audit.record(
        tx,
        context,
        {
          action:
            targetStatus === 'OPEN'
              ? 'event_session.opened'
              : 'event_session.closed',
          targetType: 'event_session',
          targetId: sessionId,
          previousValues: { status: currentStatus },
          newValues: { status: targetStatus },
        },
        facts,
      );
      return updated;
    });
  }

  private async eventExists(context: TenantContext, eventId: string) {
    return (
      (await this.prisma.event.findFirst({
        where: {
          id: eventId,
          organizationId: context.organizationId,
          deletedAt: null,
        },
        select: { id: true },
      })) !== null
    );
  }
}

function auditValues(session: EventSessionProfile): Record<string, unknown> {
  return {
    eventId: session.eventId,
    name: session.name,
    sessionType: session.sessionType,
    status: session.status,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    checkInOpensAt: session.checkInOpensAt,
    checkInClosesAt: session.checkInClosesAt,
    capacity: session.capacity,
    locationName: session.locationName,
    requiresSeparateCheckIn: session.requiresSeparateCheckIn,
  };
}

function changedAuditValues(
  session: EventSessionProfile,
  changes: EventSessionChanges,
): Record<string, unknown> {
  const values = auditValues(session);
  return Object.fromEntries(
    Object.keys(changes).map((key) => [key, values[key]]),
  );
}
