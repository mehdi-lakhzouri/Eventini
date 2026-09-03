import { Inject, Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import { ID_PREFIXES, newId } from '../../../infrastructure/database/identifiers';
import type { EventAssignmentType } from '../../../infrastructure/database/enums';
import { TENANT_SCOPED_PRISMA } from '../../../infrastructure/database/prisma.tokens';
import type { TenantScopedPrismaClient } from '../../../infrastructure/database/tenant-scope.extension';
import { AuditRecorder, type AuditRequestFacts } from '../../audit';
import { PermissionsVersionStore } from '../../identity';
import {
  EventAssignmentRepository,
  type EventAssignmentProfile,
  type EventAssignmentRefusal,
} from '../domain/event-assignment.repository';

const UNIQUE_VIOLATION = 'P2002';
const ASSIGNMENT_SELECT = {
  id: true,
  organizationId: true,
  eventId: true,
  membershipId: true,
  assignmentType: true,
  status: true,
  validFrom: true,
  validUntil: true,
  assignedAt: true,
  assignedBy: true,
  revokedAt: true,
  revokedBy: true,
} as const;

type AssignmentRow = {
  id: string; organizationId: string; eventId: string; membershipId: string;
  assignmentType: string; status: string; validFrom: Date | null; validUntil: Date | null;
  assignedAt: Date; assignedBy: string | null; revokedAt: Date | null; revokedBy: string | null;
};

const toProfile = (row: AssignmentRow): EventAssignmentProfile => ({
  assignmentId: row.id, organizationId: row.organizationId, eventId: row.eventId,
  membershipId: row.membershipId, assignmentType: row.assignmentType as EventAssignmentType,
  status: row.status, validFrom: row.validFrom, validUntil: row.validUntil,
  assignedAt: row.assignedAt, assignedBy: row.assignedBy, revokedAt: row.revokedAt, revokedBy: row.revokedBy,
});

@Injectable()
export class PrismaEventAssignmentRepository extends EventAssignmentRepository {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly versions: PermissionsVersionStore,
    private readonly audit: AuditRecorder,
  ) { super(); }

  async list(context: TenantContext, eventId: string) {
    if (!(await this.eventExists(context, eventId))) return 'EVENT_NOT_FOUND' as const;
    const rows = await this.prisma.eventUserAssignment.findMany({
      where: { organizationId: context.organizationId, eventId }, select: ASSIGNMENT_SELECT,
      orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toProfile);
  }

  async assign(context: TenantContext, input: {
    eventId: string; membershipId: string; assignmentType: EventAssignmentType;
    validFrom: Date | null; validUntil: Date | null; facts: AuditRequestFacts;
  }): Promise<EventAssignmentProfile | EventAssignmentRefusal> {
    if (!(await this.eventExists(context, input.eventId))) return 'EVENT_NOT_FOUND';
    const membership = await this.prisma.organizationMembership.findFirst({
      where: { id: input.membershipId, organizationId: context.organizationId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (membership === null) return 'MEMBERSHIP_NOT_FOUND';
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.eventUserAssignment.create({
          data: { id: newId(ID_PREFIXES.assignment), organizationId: context.organizationId,
            eventId: input.eventId, membershipId: input.membershipId, assignmentType: input.assignmentType,
            status: 'ACTIVE', validFrom: input.validFrom, validUntil: input.validUntil, assignedBy: context.userId },
          select: ASSIGNMENT_SELECT,
        });
        await this.versions.bumpMembership(input.membershipId);
        await this.audit.record(tx, context, {
          action: 'event_assignment.created', targetType: 'event_user_assignment', targetId: row.id,
          newValues: { eventId: input.eventId, membershipId: input.membershipId, assignmentType: input.assignmentType,
            validFrom: input.validFrom, validUntil: input.validUntil },
        }, input.facts);
        return toProfile(row);
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return 'ALREADY_ASSIGNED';
      throw error;
    }
  }

  async revoke(context: TenantContext, input: { eventId: string; assignmentId: string; facts: AuditRequestFacts }) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.eventUserAssignment.findFirst({
        where: { id: input.assignmentId, organizationId: context.organizationId, eventId: input.eventId, revokedAt: null },
        select: ASSIGNMENT_SELECT,
      });
      if (row === null) return 'NOT_FOUND' as const;
      const now = new Date();
      const updated = await tx.eventUserAssignment.updateMany({
        where: { id: row.id, organizationId: context.organizationId, eventId: input.eventId, revokedAt: null },
        data: { status: 'REVOKED', revokedAt: now, revokedBy: context.userId },
      });
      if (updated.count === 0) return 'NOT_FOUND' as const;
      await this.versions.bumpMembership(row.membershipId);
      await this.audit.record(tx, context, {
        action: 'event_assignment.revoked', targetType: 'event_user_assignment', targetId: row.id,
        previousValues: { status: row.status, assignmentType: row.assignmentType }, newValues: { status: 'REVOKED' },
      }, input.facts);
      return toProfile({ ...row, status: 'REVOKED', revokedAt: now, revokedBy: context.userId });
    });
  }

  private async eventExists(context: TenantContext, eventId: string): Promise<boolean> {
    return (await this.prisma.event.findFirst({
      where: { id: eventId, organizationId: context.organizationId, deletedAt: null }, select: { id: true },
    })) !== null;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}
