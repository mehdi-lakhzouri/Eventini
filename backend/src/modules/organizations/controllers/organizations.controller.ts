import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request, Response } from 'express';

import { AppException } from '../../../common/api/app-exception';
import { requireIfMatch, toETag } from '../../../common/api/concurrency';
import type { RequestWithId } from '../../../common/types/request-with-id';
import type { TenantContext } from '../../../common/types/tenant-context';
import { cookiesConfig } from '../../../config/cookies.config';
import {
  AllowsOrganizationSwitch,
  CallerResolver,
  CurrentContext,
  RequirePermission,
  CsrfService,
  setSessionCookies,
  toCallerException,
  type Caller,
} from '../../identity';
import {
  ActivateOrganizationUseCase,
  OrganizationActivationError,
} from '../application/activate-organization.use-case';
import { GetOrganizationUseCase } from '../application/get-organization.use-case';
import { ListOrganizationsUseCase } from '../application/list-organizations.use-case';
import { UpdateOrganizationUseCase } from '../application/update-organization.use-case';
import { UpdateOrganizationDto } from '../dto/update-organization.dto';
import type { OrganizationProfile } from '../domain/organization.repository';

@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly caller: CallerResolver,
    private readonly listOrganizations: ListOrganizationsUseCase,
    private readonly getOrganization: GetOrganizationUseCase,
    private readonly updateOrganization: UpdateOrganizationUseCase,
    private readonly activate: ActivateOrganizationUseCase,
    private readonly csrf: CsrfService,
    @Inject(cookiesConfig.KEY)
    private readonly cookies: ConfigType<typeof cookiesConfig>,
  ) {}

  /** The caller's own memberships — no permission, see the use case. */
  @Get()
  async list(@Req() request: Request) {
    const caller = await this.resolve(request);

    return this.listOrganizations.execute({
      userId: caller.userId,
      currentOrganizationId: caller.organizationId,
    });
  }

  /**
   * `GET /organizations/{organizationId}` — le détail de l'organisation active.
   *
   * L'identifiant du chemin ne construit pas la requête : `TenantContextGuard`
   * a déjà refusé s'il diverge de la session, et la lecture se fait sur le
   * contexte. Il nomme la ressource, il ne la sélectionne pas.
   *
   * L'`ETag` est posé ici et non par un intercepteur : c'est la version de la
   * ligne, pas un hachage de la réponse. Un hachage changerait à chaque
   * horodatage recalculé, et le client conclurait à un conflit là où rien n'a
   * bougé.
   */
  @Get(':organizationId')
  @RequirePermission('organizations.read')
  async detail(
    @CurrentContext() context: TenantContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const organization = await this.getOrganization.execute(context);

    if (organization === null) {
      throw new AppException('RESOURCE_NOT_FOUND', {
        detail: 'Organization was not found.',
      });
    }

    response.setHeader('ETag', toETag(organization.version));

    return presentOrganization(organization);
  }

  /**
   * `PATCH /organizations/{organizationId}` — EVT-042 avec EVT-032.
   *
   * `If-Match` est **obligatoire** : sans lui, deux administrateurs éditant la
   * même organisation s'écrasent en silence, et rien nulle part ne dit que le
   * travail du premier a existé.
   */
  @Patch(':organizationId')
  @RequirePermission('organizations.manage')
  async update(
    @CurrentContext() context: TenantContext,
    @Body() body: UpdateOrganizationDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const expectedVersion = requireIfMatch(request);

    const result = await this.updateOrganization.execute({
      context,
      expectedVersion,
      changes: { name: body.name, slug: body.slug },
    });

    if (typeof result === 'string') {
      throw updateFailureException(result);
    }

    // La nouvelle version part immédiatement : sans elle, le client devrait
    // relire avant sa prochaine écriture, et la plupart oublieraient.
    response.setHeader('ETag', toETag(result.version));

    return presentOrganization(result);
  }

  /**
   * A POST to a sub-resource rather than a PUT on the session: activation is
   * an action with side effects well beyond setting a field — it replaces the
   * session and revokes a token family (ADR-0010's noun-form convention).
   *
   * `201`, because what comes back is a new session, not an edited one.
   */
  @AllowsOrganizationSwitch()
  @Post(':organizationId/activation')
  @HttpCode(201)
  async activateOrganization(
    @Param('organizationId') organizationId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const caller = await this.resolve(request);

    const session = await this.activate
      .execute({
        userId: caller.userId,
        currentSessionId: caller.sessionId,
        organizationId,
        clientType: caller.clientType,
        authenticationLevel: caller.authenticationLevel,
        userAgent: readUserAgent(request),
        ipAddress: request.ip ?? null,
        requestId: (request as RequestWithId).id,
      })
      .catch((error: unknown) => {
        throw toActivationException(error);
      });

    setSessionCookies(
      response,
      {
        secure: this.cookies.secure,
        access: this.cookies.access,
        refresh: this.cookies.refresh,
      },
      session,
    );

    // The CSRF context named the session that has just been replaced, so the
    // token in the browser would fail against the successor. Rebinding here
    // keeps the client usable across the switch.
    this.csrf.bindToSession(response, session.sessionId);

    return {
      sessionId: session.sessionId,
      organizationId: session.organizationId,
      membershipId: session.membershipId,
      expiresAt: session.accessTokenExpiresAt.toISOString(),
    };
  }

  private async resolve(request: Request): Promise<Caller> {
    return this.caller.resolve(request).catch((error: unknown) => {
      throw toCallerException(error);
    });
  }
}

/**
 * Every refusal is the same `403`. Telling the caller that an organization
 * exists but is suspended, versus that it does not exist at all, turns this
 * route into a way to enumerate organization ids.
 */
function toActivationException(error: unknown): unknown {
  return error instanceof OrganizationActivationError
    ? new AppException('AUTH_TENANT_DENIED')
    : error;
}

/** Truncated: the raw header is attacker-controlled and unbounded. */
function readUserAgent(request: Request): string | null {
  const raw = request.headers['user-agent'];

  return typeof raw === 'string' ? raw.slice(0, 255) : null;
}

/**
 * Ce que la réponse expose, nommé explicitement.
 *
 * Pas de `select *` ni de renvoi direct de la ligne : les colonnes d'audit
 * (`createdBy`, `updatedBy`, `deletedBy`, `deletionReason`) et le `version`
 * interne n'ont pas à traverser. La version voyage dans l'`ETag`, qui est sa
 * place — la republier dans le corps inviterait un client à la comparer
 * lui-même plutôt qu'à renvoyer l'en-tête.
 */
function presentOrganization(organization: OrganizationProfile) {
  return {
    organizationId: organization.organizationId,
    name: organization.name,
    slug: organization.slug,
    status: organization.status,
    licensePlan: organization.licensePlan,
    userLimit: organization.userLimit,
    eventLimit: organization.eventLimit,
    isEnabled: organization.isEnabled,
    createdAt: organization.createdAt.toISOString(),
    updatedAt: organization.updatedAt.toISOString(),
  };
}

function updateFailureException(failure: string): AppException {
  switch (failure) {
    case 'NOT_FOUND':
      return new AppException('RESOURCE_NOT_FOUND', {
        detail: 'Organization was not found.',
      });

    case 'SLUG_TAKEN':
      /*
        Le slug pris peut appartenir à une organisation que l'appelant n'a pas
        le droit de voir : l'index est global aux organisations vivantes. Le
        message ne la nomme donc pas, sans quoi cette route deviendrait un
        moyen d'énumérer les organisations de la plateforme.
      */
      return new AppException('RESOURCE_ALREADY_EXISTS', {
        detail: 'This slug is already in use.',
        errors: [
          { field: 'slug', code: 'ALREADY_EXISTS', message: 'Slug is taken.' },
        ],
      });

    case 'NO_CHANGES':
      return new AppException('VALIDATION_ERROR', {
        detail: 'Provide at least one field to change.',
      });

    default:
      return new AppException('VERSION_CONFLICT', {
        detail:
          'This organization was modified by someone else. Re-read it and apply your change again.',
        retryable: true,
      });
  }
}
