import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request, Response } from 'express';

import { AppException } from '../../../../common/api/app-exception';
import { cookiesConfig } from '../../../../config/cookies.config';
import { ListUserSessionsUseCase } from '../../sessions/application/list-user-sessions.use-case';
import { RevokeAllSessionsUseCase } from '../../sessions/application/revoke-all-sessions.use-case';
import { RevokeSessionUseCase } from '../../sessions/application/revoke-session.use-case';
import {
  CallerError,
  CallerResolver,
  type Caller,
} from '../infrastructure/caller.resolver';
import { clearSessionCookies } from '../infrastructure/cookies/session-cookies';

/**
 * Session management for the signed-in caller. Separate from
 * `AuthenticationController`, which creates and rotates sessions: these
 * routes all require an established caller, and that is a different contract.
 */
@Controller('auth/sessions')
export class SessionsController {
  constructor(
    private readonly caller: CallerResolver,
    private readonly listSessions: ListUserSessionsUseCase,
    private readonly revokeSession: RevokeSessionUseCase,
    private readonly revokeAll: RevokeAllSessionsUseCase,
    @Inject(cookiesConfig.KEY)
    private readonly cookies: ConfigType<typeof cookiesConfig>,
  ) {}

  @Get()
  async list(@Req() request: Request) {
    const caller = await this.resolve(request);
    const sessions = await this.listSessions.execute({
      callerId: caller.userId,
      currentSessionId: caller.sessionId,
    });

    return sessions.map((session) => ({
      sessionId: session.sessionId,
      clientType: session.clientType,
      deviceName: session.deviceName,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      current: session.current,
    }));
  }

  @Delete('current')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const caller = await this.resolve(request);

    await this.revokeSession.execute({
      callerId: caller.userId,
      sessionId: caller.sessionId,
    });

    this.clearCookies(response);
  }

  /**
   * Global logout. `users.version` is incremented, so every access token
   * already in circulation stops matching immediately rather than at its own
   * expiry — that is the whole point of the claim.
   */
  @Delete()
  @HttpCode(204)
  async logoutEverywhere(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const caller = await this.resolve(request);

    await this.revokeAll.execute(caller.userId);

    this.clearCookies(response);
  }

  @Delete(':sessionId')
  @HttpCode(204)
  async revokeOne(
    @Param('sessionId') sessionId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const caller = await this.resolve(request);
    const revoked = await this.revokeSession.execute({
      callerId: caller.userId,
      sessionId,
    });

    if (!revoked) {
      // Someone else's session and a session that never existed answer the
      // same way. Distinguishing them would confirm that an id is real.
      throw new AppException('RESOURCE_NOT_FOUND');
    }

    if (sessionId === caller.sessionId) {
      this.clearCookies(response);
    }
  }

  private async resolve(request: Request): Promise<Caller> {
    return this.caller.resolve(request).catch((error: unknown) => {
      throw toCallerException(error);
    });
  }

  private clearCookies(response: Response): void {
    clearSessionCookies(response, {
      secure: this.cookies.secure,
      access: this.cookies.access,
      refresh: this.cookies.refresh,
    });
  }
}

function toCallerException(error: unknown): unknown {
  if (!(error instanceof CallerError)) {
    return error;
  }

  switch (error.rejection) {
    case 'SESSION_EXPIRED':
      return new AppException('AUTH_SESSION_EXPIRED');
    case 'SESSION_GONE':
    case 'STALE_VERSION':
      return new AppException('AUTH_SESSION_REVOKED');
    default:
      return new AppException('AUTHENTICATION_REQUIRED');
  }
}
