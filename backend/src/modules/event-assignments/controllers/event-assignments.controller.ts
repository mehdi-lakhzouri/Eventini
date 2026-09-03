import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { AppException } from '../../../common/api';
import type { RequestWithId } from '../../../common/types/request-with-id';
import type { TenantContext } from '../../../common/types/tenant-context';
import { AuthorizationContextReader, CurrentContext, RequirePermission } from '../../identity';
import { AssignEventUserUseCase } from '../application/assign-event-user.use-case';
import { ListEventAssignmentsUseCase } from '../application/list-event-assignments.use-case';
import { RevokeEventAssignmentUseCase } from '../application/revoke-event-assignment.use-case';
import { CreateEventAssignmentDto } from '../dto/event-assignment.dto';
import type { EventAssignmentProfile } from '../domain/event-assignment.repository';

@Controller('events/:eventId/assignments')
export class EventAssignmentsController {
  constructor(
    private readonly listAssignments: ListEventAssignmentsUseCase,
    private readonly assignUser: AssignEventUserUseCase,
    private readonly revokeAssignment: RevokeEventAssignmentUseCase,
    private readonly authorization: AuthorizationContextReader,
  ) {}

  @Get()
  @RequirePermission('users.manage_roles')
  async list(@CurrentContext() context: TenantContext, @Param('eventId') eventId: string) {
    const result = await this.listAssignments.execute(context, eventId);
    if (result === 'EVENT_NOT_FOUND') throw eventNotFound();
    return result.map(presentAssignment);
  }

  @Post()
  @RequirePermission('users.manage_roles')
  async create(
    @CurrentContext() context: TenantContext,
    @Param('eventId') eventId: string,
    @Body() body: CreateEventAssignmentDto,
    @Req() request: Request,
  ) {
    const validFrom = body.validFrom === undefined || body.validFrom === null ? null : new Date(body.validFrom);
    const validUntil = body.validUntil === undefined || body.validUntil === null ? null : new Date(body.validUntil);
    if (validFrom !== null && validUntil !== null && validFrom > validUntil) {
      throw new AppException('VALIDATION_ERROR', { detail: 'validFrom must be before validUntil.' });
    }
    const result = await this.assignUser.execute({
      context, eventId, membershipId: body.membershipId, assignmentType: body.assignmentType,
      validFrom, validUntil, facts: await this.auditFacts(context, request),
    });
    if (typeof result === 'string') throw assignmentException(result);
    return presentAssignment(result);
  }

  @Delete(':assignmentId')
  @RequirePermission('users.manage_roles')
  async revoke(
    @CurrentContext() context: TenantContext,
    @Param('eventId') eventId: string,
    @Param('assignmentId') assignmentId: string,
    @Req() request: Request,
  ) {
    const result = await this.revokeAssignment.execute({ context, eventId, assignmentId, facts: await this.auditFacts(context, request) });
    if (result === 'NOT_FOUND') throw new AppException('RESOURCE_NOT_FOUND', { detail: 'Event assignment was not found.' });
    return presentAssignment(result);
  }

  private async auditFacts(context: TenantContext, request: Request) {
    const actor = await this.authorization.read({ userId: context.userId, membershipId: context.membershipId });
    return { actorRole: actor.role, requestId: (request as RequestWithId).id ?? null, ipAddress: request.ip ?? null };
  }
}

function eventNotFound() { return new AppException('RESOURCE_NOT_FOUND', { detail: 'Event was not found.' }); }
function assignmentException(refusal: string): AppException {
  if (refusal === 'EVENT_NOT_FOUND') return eventNotFound();
  if (refusal === 'MEMBERSHIP_NOT_FOUND') return new AppException('RESOURCE_NOT_FOUND', { detail: 'Active membership was not found in this organization.' });
  return new AppException('RESOURCE_ALREADY_EXISTS', { detail: 'This active event assignment already exists.' });
}
function presentAssignment(assignment: EventAssignmentProfile) {
  return {
    assignmentId: assignment.assignmentId, organizationId: assignment.organizationId, eventId: assignment.eventId,
    membershipId: assignment.membershipId, assignmentType: assignment.assignmentType, status: assignment.status,
    validFrom: assignment.validFrom?.toISOString() ?? null, validUntil: assignment.validUntil?.toISOString() ?? null,
    assignedAt: assignment.assignedAt.toISOString(), assignedBy: assignment.assignedBy,
    revokedAt: assignment.revokedAt?.toISOString() ?? null, revokedBy: assignment.revokedBy,
  };
}
