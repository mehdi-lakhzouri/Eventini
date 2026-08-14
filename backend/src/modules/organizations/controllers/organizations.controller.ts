import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request, Response } from 'express';

import { AppException } from '../../../common/api/app-exception';
import type { RequestWithId } from '../../../common/types/request-with-id';
import { cookiesConfig } from '../../../config/cookies.config';
import {
  AllowsOrganizationSwitch,
  CallerResolver,
  CsrfService,
  setSessionCookies,
  toCallerException,
  type Caller,
} from '../../identity';
import {
  ActivateOrganizationUseCase,
  OrganizationActivationError,
} from '../application/activate-organization.use-case';
import { ListOrganizationsUseCase } from '../application/list-organizations.use-case';

@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly caller: CallerResolver,
    private readonly listOrganizations: ListOrganizationsUseCase,
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
