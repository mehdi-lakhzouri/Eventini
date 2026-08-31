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
  requireIfMatch,
  toETag,
  versionedWriteException,
} from '../../../common/api';
import { AppException } from '../../../common/api/app-exception';
import type { RequestWithId } from '../../../common/types/request-with-id';
import type { TenantContext } from '../../../common/types/tenant-context';
import {
  AuthorizationContextReader,
  CurrentContext,
  RequirePermission,
} from '../../identity';
import {
  CreateEventUseCase,
  type CreateEventRefusal,
} from '../application/create-event.use-case';
import { GetEventUseCase } from '../application/get-event.use-case';
import { ListEventsUseCase } from '../application/list-events.use-case';
import {
  UpdateEventUseCase,
  type UpdateEventRefusal,
} from '../application/update-event.use-case';
import { CreateEventDto, UpdateEventDto } from '../dto/event.dto';
import type {
  EventAuditFacts,
  EventChanges,
  EventProfile,
  EventValues,
} from '../domain/event.repository';

@Controller('events')
export class EventsController {
  constructor(
    private readonly listEvents: ListEventsUseCase,
    private readonly getEvent: GetEventUseCase,
    private readonly createEvent: CreateEventUseCase,
    private readonly updateEvent: UpdateEventUseCase,
    private readonly authorization: AuthorizationContextReader,
  ) {}

  @Get()
  @RequirePermission('events.read')
  async list(@CurrentContext() context: TenantContext) {
    const events = await this.listEvents.execute(context);
    return events.map(presentEvent);
  }

  @Post()
  @RequirePermission('events.create')
  async create(
    @CurrentContext() context: TenantContext,
    @Body() body: CreateEventDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.createEvent.execute({
      context,
      values: createValues(body),
      facts: await this.auditFacts(context, request),
    });

    if (typeof result === 'string') {
      throw createException(result);
    }

    response.setHeader('ETag', toETag(result.version));
    return presentEvent(result);
  }

  @Get(':eventId')
  @RequirePermission('events.read')
  async detail(
    @CurrentContext() context: TenantContext,
    @Param('eventId') eventId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const event = await this.getEvent.execute(context, eventId);

    if (event === null) {
      throw new AppException('RESOURCE_NOT_FOUND', {
        detail: 'Event was not found.',
      });
    }

    response.setHeader('ETag', toETag(event.version));
    return presentEvent(event);
  }

  @Patch(':eventId')
  @RequirePermission('events.update')
  async update(
    @CurrentContext() context: TenantContext,
    @Param('eventId') eventId: string,
    @Body() body: UpdateEventDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.updateEvent.execute({
      context,
      eventId,
      expectedVersion: requireIfMatch(request),
      changes: updateChanges(body),
      facts: await this.auditFacts(context, request),
    });

    if (typeof result === 'string') {
      throw updateException(result);
    }

    response.setHeader('ETag', toETag(result.version));
    return presentEvent(result);
  }

  private async auditFacts(
    context: TenantContext,
    request: Request,
  ): Promise<EventAuditFacts> {
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

function createValues(body: CreateEventDto): EventValues {
  return {
    name: body.name,
    slug: body.slug,
    description: body.description ?? null,
    timezone: body.timezone,
    startsAt: new Date(body.startsAt),
    endsAt: new Date(body.endsAt),
    checkInOpensAt:
      body.checkInOpensAt === undefined || body.checkInOpensAt === null
        ? null
        : new Date(body.checkInOpensAt),
    checkInClosesAt:
      body.checkInClosesAt === undefined || body.checkInClosesAt === null
        ? null
        : new Date(body.checkInClosesAt),
    capacity: body.capacity ?? null,
    locationName: body.locationName ?? null,
    settings: body.settings ?? {},
  };
}

function updateChanges(body: UpdateEventDto): EventChanges {
  const changes: EventChanges = {};

  if (body.name !== undefined) changes.name = body.name;
  if (body.slug !== undefined) changes.slug = body.slug;
  if (body.description !== undefined) changes.description = body.description;
  if (body.timezone !== undefined) changes.timezone = body.timezone;
  if (body.startsAt !== undefined) changes.startsAt = new Date(body.startsAt);
  if (body.endsAt !== undefined) changes.endsAt = new Date(body.endsAt);
  if (body.checkInOpensAt !== undefined) {
    changes.checkInOpensAt =
      body.checkInOpensAt === null ? null : new Date(body.checkInOpensAt);
  }
  if (body.checkInClosesAt !== undefined) {
    changes.checkInClosesAt =
      body.checkInClosesAt === null ? null : new Date(body.checkInClosesAt);
  }
  if (body.capacity !== undefined) changes.capacity = body.capacity;
  if (body.locationName !== undefined) {
    changes.locationName = body.locationName;
  }
  if (body.settings !== undefined) changes.settings = body.settings;

  return changes;
}

function presentEvent(event: EventProfile) {
  return {
    eventId: event.eventId,
    organizationId: event.organizationId,
    name: event.name,
    slug: event.slug,
    description: event.description,
    status: event.status,
    eventCode: event.eventCode,
    timezone: event.timezone,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    checkInOpensAt: event.checkInOpensAt?.toISOString() ?? null,
    checkInClosesAt: event.checkInClosesAt?.toISOString() ?? null,
    capacity: event.capacity,
    locationName: event.locationName,
    settings: event.settings,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

function createException(failure: CreateEventRefusal): AppException {
  return failure === 'SLUG_TAKEN'
    ? slugTaken()
    : new AppException('VALIDATION_ERROR', {
        detail:
          'startsAt must be before endsAt, and the check-in opening must be before its closing.',
      });
}

function updateException(failure: UpdateEventRefusal): AppException {
  switch (failure) {
    case 'NOT_FOUND':
    case 'CONFLICT':
      return versionedWriteException(failure, 'Event');
    case 'SLUG_TAKEN':
      return slugTaken();
    case 'NO_CHANGES':
      return new AppException('VALIDATION_ERROR', {
        detail: 'Provide at least one field to change.',
      });
    default:
      return new AppException('VALIDATION_ERROR', {
        detail:
          'startsAt must be before endsAt, and the check-in opening must be before its closing.',
      });
  }
}

function slugTaken(): AppException {
  return new AppException('RESOURCE_ALREADY_EXISTS', {
    detail: 'This event slug is already in use in the organization.',
    errors: [
      {
        field: 'slug',
        code: 'ALREADY_EXISTS',
        message: 'Slug is taken.',
      },
    ],
  });
}
