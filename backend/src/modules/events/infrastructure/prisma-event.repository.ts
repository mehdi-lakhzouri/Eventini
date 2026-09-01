import { Inject, Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import { Prisma } from '../../../infrastructure/database/prisma/generated/client';
import { TENANT_SCOPED_PRISMA } from '../../../infrastructure/database/prisma.tokens';
import type { TenantScopedPrismaClient } from '../../../infrastructure/database/tenant-scope.extension';
import { AuditRecorder } from '../../audit';
import {
  EventRepository,
  type EventAuditFacts,
  type EventChanges,
  type EventCreateFailure,
  type EventProfile,
  type EventUpdateFailure,
  type EventValues,
} from '../domain/event.repository';
import { isValidEventSchedule } from '../domain/event-schedule';

const UNIQUE_VIOLATION = 'P2002';

const EVENT_SELECT = {
  id: true,
  organizationId: true,
  name: true,
  slug: true,
  description: true,
  status: true,
  eventCode: true,
  timezone: true,
  startsAt: true,
  endsAt: true,
  checkInOpensAt: true,
  checkInClosesAt: true,
  capacity: true,
  locationName: true,
  settings: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;

type EventRow = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  eventCode: string;
  timezone: string;
  startsAt: Date;
  endsAt: Date;
  checkInOpensAt: Date | null;
  checkInClosesAt: Date | null;
  capacity: number | null;
  locationName: string | null;
  settings: Prisma.JsonValue;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

function settingsObject(value: Prisma.JsonValue): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value
    : {};
}

const toProfile = (row: EventRow): EventProfile => ({
  eventId: row.id,
  organizationId: row.organizationId,
  name: row.name,
  slug: row.slug,
  description: row.description,
  status: row.status,
  eventCode: row.eventCode,
  timezone: row.timezone,
  startsAt: row.startsAt,
  endsAt: row.endsAt,
  checkInOpensAt: row.checkInOpensAt,
  checkInClosesAt: row.checkInClosesAt,
  capacity: row.capacity,
  locationName: row.locationName,
  settings: settingsObject(row.settings),
  version: row.version,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

@Injectable()
export class PrismaEventRepository extends EventRepository {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA)
    private readonly prisma: TenantScopedPrismaClient,
    private readonly audit: AuditRecorder,
  ) {
    super();
  }

  async list(context: TenantContext): Promise<EventProfile[]> {
    const rows = await this.prisma.event.findMany({
      where: {
        organizationId: context.organizationId,
        deletedAt: null,
      },
      select: EVENT_SELECT,
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
    });

    return rows.map(toProfile);
  }

  async find(
    context: TenantContext,
    eventId: string,
  ): Promise<EventProfile | null> {
    const row = await this.prisma.event.findFirst({
      where: {
        id: eventId,
        organizationId: context.organizationId,
        deletedAt: null,
      },
      select: EVENT_SELECT,
    });

    return row === null ? null : toProfile(row);
  }

  async create(
    context: TenantContext,
    input: EventValues & {
      readonly eventId: string;
      readonly eventCode: string;
      readonly facts: EventAuditFacts;
    },
  ): Promise<EventProfile | EventCreateFailure> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.event.create({
          data: {
            id: input.eventId,
            organizationId: context.organizationId,
            name: input.name,
            slug: input.slug,
            description: input.description,
            status: 'DRAFT',
            eventCode: input.eventCode,
            timezone: input.timezone,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            checkInOpensAt: input.checkInOpensAt,
            checkInClosesAt: input.checkInClosesAt,
            capacity: input.capacity,
            locationName: input.locationName,
            settings: input.settings as Prisma.InputJsonValue,
            createdBy: context.userId,
            updatedBy: context.userId,
          },
          select: EVENT_SELECT,
        });

        await this.audit.record(
          tx,
          context,
          {
            action: 'event.created',
            targetType: 'event',
            targetId: row.id,
            newValues: auditValues(toProfile(row)),
          },
          input.facts,
        );

        return toProfile(row);
      });
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const slugExists = await this.prisma.event.findFirst({
        where: {
          organizationId: context.organizationId,
          slug: input.slug,
          deletedAt: null,
        },
        select: { id: true },
      });

      return slugExists === null ? 'EVENT_CODE_COLLISION' : 'SLUG_TAKEN';
    }
  }

  async update(
    context: TenantContext,
    eventId: string,
    expectedVersion: number,
    changes: EventChanges,
    facts: EventAuditFacts,
  ): Promise<EventProfile | EventUpdateFailure> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const currentRow = await tx.event.findFirst({
          where: {
            id: eventId,
            organizationId: context.organizationId,
            deletedAt: null,
          },
          select: EVENT_SELECT,
        });

        if (currentRow === null) {
          return 'NOT_FOUND';
        }

        if (currentRow.version !== expectedVersion) {
          return 'CONFLICT';
        }

        const current = toProfile(currentRow);
        const proposed = {
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
        };

        if (!isValidEventSchedule(proposed)) {
          return 'INVALID_SCHEDULE';
        }

        const { settings, ...scalarChanges } = changes;
        const affected = await tx.event.updateMany({
          where: {
            id: eventId,
            organizationId: context.organizationId,
            version: expectedVersion,
            deletedAt: null,
          },
          data: {
            ...scalarChanges,
            ...(settings === undefined
              ? {}
              : { settings: settings as Prisma.InputJsonValue }),
            version: { increment: 1 },
            updatedBy: context.userId,
          },
        });

        if (affected.count === 0) {
          return 'CONFLICT';
        }

        const updatedRow = await tx.event.findFirst({
          where: {
            id: eventId,
            organizationId: context.organizationId,
            deletedAt: null,
          },
          select: EVENT_SELECT,
        });

        if (updatedRow === null) {
          return 'NOT_FOUND';
        }

        const updated = toProfile(updatedRow);
        await this.audit.record(
          tx,
          context,
          {
            action: 'event.updated',
            targetType: 'event',
            targetId: eventId,
            previousValues: changedAuditValues(current, changes),
            newValues: changedAuditValues(updated, changes),
          },
          facts,
        );

        return updated;
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        return 'SLUG_TAKEN';
      }

      throw error instanceof Error
        ? error
        : new Error('Event update failed.', { cause: error });
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

function auditValues(event: EventProfile): Record<string, unknown> {
  return {
    name: event.name,
    slug: event.slug,
    status: event.status,
    eventCode: event.eventCode,
    timezone: event.timezone,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    checkInOpensAt: event.checkInOpensAt,
    checkInClosesAt: event.checkInClosesAt,
    capacity: event.capacity,
    locationName: event.locationName,
  };
}

function changedAuditValues(
  event: EventProfile,
  changes: EventChanges,
): Record<string, unknown> {
  const values = auditValues(event);
  return Object.fromEntries(
    Object.keys(changes).map((key) => [key, values[key]]),
  );
}
