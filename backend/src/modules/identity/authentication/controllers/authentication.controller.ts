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
import {
  AuthenticationError,
  isGenericRejection,
} from '../domain/authentication.errors';
import { LoginRequestDto } from '../dto/login.dto';
import { setSessionCookies } from '../infrastructure/cookies/session-cookies';

/**
 * `POST /api/v1/auth/sessions`. Login creates a session, so it is a POST to
 * the collection rather than an `/auth/login` verb — the resolution of C-2.
 */
@Controller('auth/sessions')
export class AuthenticationController {
  constructor(
    private readonly login: LoginUseCase,
    @Inject(cookiesConfig.KEY)
    private readonly cookies: ConfigType<typeof cookiesConfig>,
  ) {}

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
        throw toHttpException(error);
      });

    setSessionCookies(
      response,
      {
        secure: this.cookies.secure,
        access: this.cookies.access,
        refresh: this.cookies.refresh,
      },
      result,
    );

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
}

/**
 * Every rejection but `NO_ACCESS` becomes the same 401. An unknown account, a
 * wrong password, a suspended user and a suspended organization have to be
 * indistinguishable, or the endpoint answers questions it was never asked.
 */
function toHttpException(error: unknown): unknown {
  if (!(error instanceof AuthenticationError)) {
    return error;
  }

  return isGenericRejection(error.rejection)
    ? new AppException('AUTH_INVALID_CREDENTIALS')
    : new AppException('AUTH_TENANT_DENIED');
}

/** Truncated: the raw header is attacker-controlled and unbounded. */
function readUserAgent(request: Request): string | null {
  const raw = request.headers['user-agent'];

  return typeof raw === 'string' ? raw.slice(0, 255) : null;
}
