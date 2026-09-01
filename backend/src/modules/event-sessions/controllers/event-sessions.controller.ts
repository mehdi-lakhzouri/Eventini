import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  AppException,
  requireIfMatch,
  toETag,
  versionedWriteException,
} from '../../../common/api';
import type { RequestWithId } from '../../../common/types/request-with-id';
import type { TenantContext } from '../../../common/types/tenant-context';
import {
  AuthorizationContextReader,
  CurrentContext,
  RequirePermission,
} from '../../identity';
import {
  CreateEventSessionUseCase,
  type CreateEventSessionRefusal,
} from '../application/create-event-session.use-case';
import { GetEventSessionUseCase } from '../application/get-event-session.use-case';
import { ListEventSessionsUseCase } from '../application/list-event-sessions.use-case';
import {
  UpdateEventSessionUseCase,
  type UpdateEventSessionRefusal,
} from '../application/update-event-session.use-case';
import {
  CreateEventSessionDto,
  UpdateEventSessionDto,
} from '../dto/event-session.dto';
import type {
  EventSessionChanges,
  EventSessionProfile,
  EventSessionValues,
} from '../domain/event-session.repository';

@Controller('events/:eventId/sessions')
export class EventSessionsController {
  constructor(
    private readonly listSessions: ListEventSessionsUseCase,
    private readonly getSession: GetEventSessionUseCase,
    private readonly createSession: CreateEventSessionUseCase,
    private readonly updateSession: UpdateEventSessionUseCase,
    private readonly authorization: AuthorizationContextReader,
  ) {}

  @Get()
  @RequirePermission('event_sessions.manage')
  async list(
    @CurrentContext() context: TenantContext,
    @Param('eventId') eventId: string,
  ) {
    const result = await this.listSessions.execute(context, eventId);
    if (result === 'EVENT_NOT_FOUND') throw notFound('Event');
    return result.map(presentSession);
  }

  @Post()
  @RequirePermission('event_sessions.manage')
  async create(
    @CurrentContext() context: TenantContext,
    @Param('eventId') eventId: string,
    @Body() body: CreateEventSessionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.createSession.execute({
      context,
      eventId,
      values: createValues(body),
      facts: await this.auditFacts(context, request),
    });
    if (typeof result === 'string') throw createException(result);
    response.setHeader('ETag', toETag(result.version));
    return presentSession(result);
  }

  @Get(':sessionId')
  @RequirePermission('event_sessions.manage')
  async detail(
    @CurrentContext() context: TenantContext,
    @Param('eventId') eventId: string,
    @Param('sessionId') sessionId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.getSession.execute(context, eventId, sessionId);
    if (session === null) throw notFound('Event session');
    response.setHeader('ETag', toETag(session.version));
    return presentSession(session);
  }

  @Patch(':sessionId')
  @RequirePermission('event_sessions.manage')
  async update(
    @CurrentContext() context: TenantContext,
    @Param('eventId') eventId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: UpdateEventSessionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.updateSession.execute({
      context,
      eventId,
      sessionId,
      expectedVersion: requireIfMatch(request),
      changes: updateChanges(body),
      facts: await this.auditFacts(context, request),
    });
    if (typeof result === 'string') throw updateException(result);
    response.setHeader('ETag', toETag(result.version));
    return presentSession(result);
  }

  private async auditFacts(context: TenantContext, request: Request) {
    const actor = await this.authorization.read({
      userId: context.userId,
      membershipId: context.membershipId,
    });
    return {
      actorRole: actor.role,
      requestId: (request as RequestWithId).id ?? null,
      ipAddress: request.ip ?? null,
    };
  }
}

function createValues(body: CreateEventSessionDto): EventSessionValues {
  return {
    name: body.name,
    sessionType: body.sessionType,
    startsAt: new Date(body.startsAt),
    endsAt: new Date(body.endsAt),
    checkInOpensAt:
      body.checkInOpensAt == null ? null : new Date(body.checkInOpensAt),
    checkInClosesAt:
      body.checkInClosesAt == null ? null : new Date(body.checkInClosesAt),
    capacity: body.capacity ?? null,
    locationName: body.locationName ?? null,
    requiresSeparateCheckIn: body.requiresSeparateCheckIn ?? true,
  };
}

function updateChanges(body: UpdateEventSessionDto): EventSessionChanges {
  const changes: EventSessionChanges = {};
  if (body.name !== undefined) changes.name = body.name;
  if (body.sessionType !== undefined) changes.sessionType = body.sessionType;
  if (body.startsAt !== undefined) changes.startsAt = new Date(body.startsAt);
  if (body.endsAt !== undefined) changes.endsAt = new Date(body.endsAt);
  if (body.checkInOpensAt !== undefined)
    changes.checkInOpensAt =
      body.checkInOpensAt === null ? null : new Date(body.checkInOpensAt);
  if (body.checkInClosesAt !== undefined)
    changes.checkInClosesAt =
      body.checkInClosesAt === null ? null : new Date(body.checkInClosesAt);
  if (body.capacity !== undefined) changes.capacity = body.capacity;
  if (body.locationName !== undefined) changes.locationName = body.locationName;
  if (body.requiresSeparateCheckIn !== undefined)
    changes.requiresSeparateCheckIn = body.requiresSeparateCheckIn;
  return changes;
}

function presentSession(session: EventSessionProfile) {
  return {
    sessionId: session.sessionId,
    organizationId: session.organizationId,
    eventId: session.eventId,
    name: session.name,
    sessionType: session.sessionType,
    status: session.status,
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    checkInOpensAt: session.checkInOpensAt?.toISOString() ?? null,
    checkInClosesAt: session.checkInClosesAt?.toISOString() ?? null,
    capacity: session.capacity,
    locationName: session.locationName,
    requiresSeparateCheckIn: session.requiresSeparateCheckIn,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

function createException(failure: CreateEventSessionRefusal) {
  return failure === 'EVENT_NOT_FOUND' ? notFound('Event') : invalidSchedule();
}

function updateException(failure: UpdateEventSessionRefusal) {
  if (failure === 'NOT_FOUND' || failure === 'CONFLICT')
    return versionedWriteException(failure, 'Event session');
  if (failure === 'NO_CHANGES')
    return new AppException('VALIDATION_ERROR', {
      detail: 'Provide at least one field to change.',
    });
  return invalidSchedule();
}

function notFound(resource: string) {
  return new AppException('RESOURCE_NOT_FOUND', {
    detail: `${resource} was not found.`,
  });
}

function invalidSchedule() {
  return new AppException('VALIDATION_ERROR', {
    detail:
      'startsAt must be before endsAt, and the check-in opening must be before its closing.',
  });
}
