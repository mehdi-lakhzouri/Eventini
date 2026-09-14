import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
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
import {
  attachPaginationMeta,
  CursorCodec,
  DEFAULT_PAGE_LIMIT,
  type CursorKey,
} from '../../../common/api/pagination';
import type { RequestWithId } from '../../../common/types/request-with-id';
import type { TenantContext } from '../../../common/types/tenant-context';
import {
  AuthorizationContextReader,
  CurrentContext,
  RequirePermission,
} from '../../identity';
import {
  CreateParticipantUseCase,
  type CreateParticipantRefusal,
} from '../application/create-participant.use-case';
import { DeleteParticipantUseCase } from '../application/delete-participant.use-case';
import { GetParticipantUseCase } from '../application/get-participant.use-case';
import { ListParticipantsUseCase } from '../application/list-participants.use-case';
import {
  UpdateParticipantUseCase,
  type UpdateParticipantRefusal,
} from '../application/update-participant.use-case';
import type {
  ParticipantAuditFacts,
  ParticipantChanges,
  ParticipantDetail,
  ParticipantListQuery,
  ParticipantProfile,
  ParticipantValues,
} from '../domain/participant.repository';
import { MAX_METADATA_BYTES } from '../domain/participant-values';
import {
  CreateParticipantDto,
  DeleteParticipantDto,
  ListParticipantsQueryDto,
  UpdateParticipantDto,
} from '../dto/participant.dto';

/**
 * `/participants` — sprint-10 EVT-054.
 *
 * A participant of another organization answers `404`, like every
 * id-addressed resource outside `/organizations/{organizationId}`: the lookup
 * runs under the caller's `TenantContext`, and the tenant guard makes a
 * query that could tell "another tenant's" from "nobody's" impossible to
 * write. Nothing about the other row — not even its existence — is observable.
 */
@Controller('participants')
export class ParticipantsController {
  constructor(
    private readonly listParticipants: ListParticipantsUseCase,
    private readonly getParticipant: GetParticipantUseCase,
    private readonly createParticipant: CreateParticipantUseCase,
    private readonly updateParticipant: UpdateParticipantUseCase,
    private readonly deleteParticipant: DeleteParticipantUseCase,
    private readonly cursors: CursorCodec,
    private readonly authorization: AuthorizationContextReader,
  ) {}

  @Get()
  @RequirePermission('participants.read')
  async list(
    @CurrentContext() context: TenantContext,
    @Query() params: ListParticipantsQueryDto,
    @Req() request: Request,
  ) {
    if (params.after !== undefined && params.before !== undefined) {
      throw new AppException('VALIDATION_ERROR', {
        detail: 'after and before are mutually exclusive.',
        errors: [
          {
            field: 'before',
            code: 'CONFLICTING_PARAMETER',
            message: 'Send either after or before, not both.',
          },
        ],
      });
    }

    const sortBy = params.sortBy ?? 'createdAt';
    const sortOrder = params.sortOrder ?? 'desc';
    const search = params.search ?? null;
    const participantTypes = [...new Set(params.participantType ?? [])].sort();
    const limit = params.limit ?? DEFAULT_PAGE_LIMIT;

    // Every input that changes the result set, and nothing that only changes
    // its slicing — `limit` is left out so a client can resize its pages.
    const scope = this.cursors.scope({
      resource: 'participants',
      organizationId: context.organizationId,
      sortBy,
      sortOrder,
      search: search?.toLowerCase() ?? null,
      participantTypes,
    });

    const query: ParticipantListQuery = {
      limit,
      sortBy,
      sortOrder,
      search,
      participantTypes,
      boundary: this.boundaryOf(params, scope, sortBy),
    };

    const page = await this.listParticipants.execute(context, query);
    const cursorOf = (participant: ParticipantProfile): CursorKey => [
      sortBy === 'createdAt'
        ? participant.createdAt.toISOString()
        : participant.lastName,
      participant.participantId,
    ];
    const first = page.items.at(0);
    const last = page.items.at(-1);

    attachPaginationMeta(request, {
      limit,
      hasNextPage: page.hasNextPage,
      hasPreviousPage: page.hasPreviousPage,
      nextCursor:
        page.hasNextPage && last !== undefined
          ? this.cursors.encode(scope, cursorOf(last))
          : null,
      previousCursor:
        page.hasPreviousPage && first !== undefined
          ? this.cursors.encode(scope, cursorOf(first))
          : null,
    });

    return page.items.map(presentParticipant);
  }

  @Post()
  @RequirePermission('participants.create')
  async create(
    @CurrentContext() context: TenantContext,
    @Body() body: CreateParticipantDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.createParticipant.execute({
      context,
      values: createValues(body),
      facts: await this.auditFacts(context, request),
    });

    if (typeof result === 'string') {
      throw createException(result);
    }

    response.setHeader('ETag', toETag(result.version));
    response.setHeader(
      'Location',
      `/api/v1/participants/${result.participantId}`,
    );
    return presentDetail(result);
  }

  @Get(':participantId')
  @RequirePermission('participants.read')
  async detail(
    @CurrentContext() context: TenantContext,
    @Param('participantId') participantId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const participant = await this.getParticipant.execute(
      context,
      participantId,
    );

    if (participant === null) {
      throw participantNotFound();
    }

    response.setHeader('ETag', toETag(participant.version));
    return presentDetail(participant);
  }

  @Patch(':participantId')
  @RequirePermission('participants.update')
  async update(
    @CurrentContext() context: TenantContext,
    @Param('participantId') participantId: string,
    @Body() body: UpdateParticipantDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.updateParticipant.execute({
      context,
      participantId,
      expectedVersion: requireIfMatch(request),
      changes: updateChanges(body),
      facts: await this.auditFacts(context, request),
    });

    if (typeof result === 'string') {
      throw updateException(result);
    }

    response.setHeader('ETag', toETag(result.version));
    return presentDetail(result);
  }

  /**
   * Soft deletion. `204` on the first call and on every repeat
   * (API_CONVENTIONS.md §5); `404` only for an id the organization never had.
   *
   * No `If-Match`: a deletion does not merge with a concurrent edit, and a
   * precondition would turn the repeated `DELETE` the conventions promise
   * `204` into a `409` the moment the first one incremented the version.
   */
  @Delete(':participantId')
  @HttpCode(204)
  @RequirePermission('participants.delete')
  async remove(
    @CurrentContext() context: TenantContext,
    @Param('participantId') participantId: string,
    @Body() body: DeleteParticipantDto,
    @Req() request: Request,
  ): Promise<void> {
    const result = await this.deleteParticipant.execute({
      context,
      participantId,
      reason: body.reason ?? null,
      facts: await this.auditFacts(context, request),
    });

    if (result === 'NOT_FOUND') {
      throw participantNotFound();
    }
  }

  private boundaryOf(
    params: ListParticipantsQueryDto,
    scope: string,
    sortBy: ParticipantListQuery['sortBy'],
  ): ParticipantListQuery['boundary'] {
    const direction = params.before === undefined ? 'after' : 'before';
    const token = params.before ?? params.after;

    if (token === undefined) {
      return null;
    }

    const key = this.cursors.decode(token, scope, direction);

    // Unreachable for a cursor this server signed under this scope; checked
    // anyway so that a future change to the key format fails as a 400.
    if (sortBy === 'createdAt' && Number.isNaN(Date.parse(key[0]))) {
      throw new AppException('VALIDATION_ERROR', {
        detail: 'The pagination cursor is invalid.',
      });
    }

    return { direction, key };
  }

  private async auditFacts(
    context: TenantContext,
    request: Request,
  ): Promise<ParticipantAuditFacts> {
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

function createValues(body: CreateParticipantDto): ParticipantValues {
  return {
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email ?? null,
    phone: body.phone ?? null,
    participantType: body.participantType ?? 'STANDARD',
    organizationName: body.organizationName ?? null,
    jobTitle: body.jobTitle ?? null,
    country: body.country ?? null,
    externalReference: body.externalReference ?? null,
    metadata: body.metadata ?? {},
  };
}

function updateChanges(body: UpdateParticipantDto): ParticipantChanges {
  const changes: ParticipantChanges = {};

  if (body.firstName !== undefined) changes.firstName = body.firstName;
  if (body.lastName !== undefined) changes.lastName = body.lastName;
  if (body.email !== undefined) changes.email = body.email;
  if (body.phone !== undefined) changes.phone = body.phone;
  if (body.participantType !== undefined) {
    changes.participantType = body.participantType;
  }
  if (body.organizationName !== undefined) {
    changes.organizationName = body.organizationName;
  }
  if (body.jobTitle !== undefined) changes.jobTitle = body.jobTitle;
  if (body.country !== undefined) changes.country = body.country;
  if (body.externalReference !== undefined) {
    changes.externalReference = body.externalReference;
  }
  if (body.metadata !== undefined) changes.metadata = body.metadata;

  return changes;
}

function presentParticipant(participant: ParticipantProfile) {
  return {
    participantId: participant.participantId,
    organizationId: participant.organizationId,
    firstName: participant.firstName,
    lastName: participant.lastName,
    email: participant.email,
    phone: participant.phone,
    participantType: participant.participantType,
    organizationName: participant.organizationName,
    jobTitle: participant.jobTitle,
    country: participant.country,
    externalReference: participant.externalReference,
    metadata: participant.metadata,
    possibleDuplicateCount: participant.possibleDuplicateCount,
    createdAt: participant.createdAt.toISOString(),
    updatedAt: participant.updatedAt.toISOString(),
  };
}

function presentDetail(participant: ParticipantDetail) {
  return {
    ...presentParticipant(participant),
    possibleDuplicateIds: participant.possibleDuplicateIds,
  };
}

function participantNotFound(): AppException {
  return new AppException('RESOURCE_NOT_FOUND', {
    detail: 'Participant was not found.',
  });
}

function emailTaken(): AppException {
  return new AppException('RESOURCE_ALREADY_EXISTS', {
    detail:
      'Another participant of this organization already uses this email address.',
    errors: [
      {
        field: 'email',
        code: 'ALREADY_EXISTS',
        message: 'Email is already used by another participant.',
      },
    ],
  });
}

function metadataTooLarge(): AppException {
  return new AppException('VALIDATION_ERROR', {
    detail: `metadata must serialize to at most ${MAX_METADATA_BYTES} bytes.`,
    errors: [
      {
        field: 'metadata',
        code: 'TOO_LARGE',
        message: `metadata must serialize to at most ${MAX_METADATA_BYTES} bytes.`,
      },
    ],
  });
}

function createException(failure: CreateParticipantRefusal): AppException {
  return failure === 'EMAIL_TAKEN' ? emailTaken() : metadataTooLarge();
}

function updateException(failure: UpdateParticipantRefusal): AppException {
  switch (failure) {
    case 'NOT_FOUND':
    case 'CONFLICT':
      return versionedWriteException(failure, 'Participant');
    case 'EMAIL_TAKEN':
      return emailTaken();
    case 'METADATA_TOO_LARGE':
      return metadataTooLarge();
    case 'NO_CHANGES':
      return new AppException('VALIDATION_ERROR', {
        detail: 'Provide at least one field to change.',
      });
  }
}
