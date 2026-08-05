import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request, Response } from 'express';

import { AppException } from '../../../../common/api/app-exception';
import type { RequestWithId } from '../../../../common/types/request-with-id';
import { cookiesConfig } from '../../../../config/cookies.config';
import { LoginUseCase } from '../application/login.use-case';
import { RefreshSessionUseCase } from '../application/refresh-session.use-case';
import {
  AuthenticationError,
  isGenericRejection,
} from '../domain/authentication.errors';
import { RotationError } from '../domain/rotation.errors';
import { LoginRequestDto } from '../dto/login.dto';
import {
  clearSessionCookies,
  setSessionCookies,
  type SessionCookieSettings,
} from '../infrastructure/cookies/session-cookies';

@Controller('auth/sessions')
export class AuthenticationController {
  constructor(
    private readonly login: LoginUseCase,
    private readonly refresh: RefreshSessionUseCase,
    @Inject(cookiesConfig.KEY)
    private readonly cookies: ConfigType<typeof cookiesConfig>,
  ) {}

  /**
   * Login creates a session, so it is a POST to the collection rather than an
   * `/auth/login` verb — the resolution of C-2.
   */
  @Post()
  @HttpCode(201)
  async createSession(
    @Body() body: LoginRequestDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.login
      .execute({
        email: body.email,
        password: body.password,
        clientType: body.clientType,
        userAgent: readUserAgent(request),
        ipAddress: request.ip ?? null,
        requestId: (request as RequestWithId).id,
      })
      .catch((error: unknown) => {
        throw toLoginException(error);
      });

    setSessionCookies(response, this.cookieSettings(), result);

    // Tokens live in cookies, never in the body: a body token is readable by
    // JavaScript, which AUTH-INV-001 forbids.
    return {
      userId: result.userId,
      sessionId: result.sessionId,
      organizationId: result.organizationId,
      requiresOrganizationSelection: result.requiresOrganizationSelection,
      expiresAt: result.accessTokenExpiresAt.toISOString(),
    };
  }

  /**
   * The refresh token comes from its own path-scoped cookie, never from the
   * body, so nothing that reads the rest of the API can reach it.
   */
  @Post('current/rotation')
  @HttpCode(200)
  async rotateSession(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const presented = readRefreshCookie(request, this.cookies.refresh.name);

    if (presented === undefined) {
      throw new AppException('AUTHENTICATION_REQUIRED');
    }

    const result = await this.refresh
      .execute(presented)
      .catch((error: unknown) => {
        // Replay clears the cookies on the way out: the family is gone, so
        // leaving a dead token in the browser only produces more failures.
        if (
          error instanceof RotationError &&
          error.rejection === 'REUSE_DETECTED'
        ) {
          clearSessionCookies(response, this.cookieSettings());
        }

        throw toRotationException(error);
      });

    setSessionCookies(response, this.cookieSettings(), result);

    return {
      sessionId: result.sessionId,
      expiresAt: result.accessTokenExpiresAt.toISOString(),
    };
  }

  private cookieSettings(): SessionCookieSettings {
    return {
      secure: this.cookies.secure,
      access: this.cookies.access,
      refresh: this.cookies.refresh,
    };
  }
}

/**
 * Every rejection but `NO_ACCESS` becomes the same 401. An unknown account, a
 * wrong password, a suspended user and a suspended organization have to be
 * indistinguishable, or the endpoint answers questions it was never asked.
 */
function toLoginException(error: unknown): unknown {
  if (!(error instanceof AuthenticationError)) {
    return error;
  }

  return isGenericRejection(error.rejection)
    ? new AppException('AUTH_INVALID_CREDENTIALS')
    : new AppException('AUTH_TENANT_DENIED');
}

/**
 * Replay is the one rotation failure with its own code, because it is the one
 * a client must react to differently: sign in again rather than retry. A lost
 * race is a 409 — the winner's cookie is already in the browser.
 */
function toRotationException(error: unknown): unknown {
  if (!(error instanceof RotationError)) {
    return error;
  }

  switch (error.rejection) {
    case 'REUSE_DETECTED':
      return new AppException('AUTH_REFRESH_REUSE_DETECTED');
    case 'CONCURRENT_ROTATION':
      return new AppException('VERSION_CONFLICT');
    case 'SESSION_REVOKED':
      return new AppException('AUTH_SESSION_REVOKED');
    case 'TOKEN_EXPIRED':
    case 'SESSION_IDLE_EXPIRED':
    case 'SESSION_ABSOLUTE_EXPIRED':
      return new AppException('AUTH_SESSION_EXPIRED');
    default:
      return new AppException('AUTHENTICATION_REQUIRED');
  }
}

function readRefreshCookie(request: Request, name: string): string | undefined {
  const cookies = (request as { cookies?: Record<string, unknown> }).cookies;
  const value = cookies?.[name];

  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Truncated: the raw header is attacker-controlled and unbounded. */
function readUserAgent(request: Request): string | null {
  const raw = request.headers['user-agent'];

  return typeof raw === 'string' ? raw.slice(0, 255) : null;
}
