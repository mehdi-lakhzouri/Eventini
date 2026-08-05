import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request, Response } from 'express';

import { AppException } from '../../../../common/api/app-exception';
import type { RequestWithId } from '../../../../common/types/request-with-id';
import { cookiesConfig } from '../../../../config/cookies.config';
import { CsrfService } from '../../csrf';
import { MfaError } from '../../mfa/domain/mfa.errors';
import { CompleteMfaLoginUseCase } from '../application/complete-mfa-login.use-case';
import { AuthenticationError } from '../domain/authentication.errors';
import { VerifyMfaChallengeDto } from '../dto/mfa-challenge.dto';
import {
  setSessionCookies,
  type SessionCookieSettings,
} from '../infrastructure/cookies/session-cookies';

/**
 * The second half of a gated login.
 *
 * It lives beside the session routes rather than in the MFA module because
 * what it produces is a session — cookies, an access token, a refresh token.
 * The MFA module owns enrolment and method management, which produce none of
 * those. Splitting on what is issued keeps session issuance in one module.
 */
@Controller('auth/mfa/challenges')
export class MfaChallengeController {
  constructor(
    private readonly completeLogin: CompleteMfaLoginUseCase,
    private readonly csrf: CsrfService,
    @Inject(cookiesConfig.KEY)
    private readonly cookies: ConfigType<typeof cookiesConfig>,
  ) {}

  @Post(':challengeId/verification')
  @HttpCode(201)
  async verify(
    @Param('challengeId') challengeId: string,
    @Body() body: VerifyMfaChallengeDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.completeLogin
      .execute({
        challengeId,
        code: body.code,
        userAgent: readUserAgent(request),
        ipAddress: request.ip ?? null,
        requestId: (request as RequestWithId).id,
      })
      .catch((error: unknown) => {
        throw toVerificationException(error);
      });

    setSessionCookies(response, this.cookieSettings(), result.session);

    // This is the request that creates the session on a gated login, so this
    // is where the pre-session token stops working (ADR-0016).
    this.csrf.bindToSession(response, result.session.sessionId);

    return {
      userId: result.session.userId,
      sessionId: result.session.sessionId,
      organizationId: result.session.organizationId,
      requiresOrganizationSelection:
        result.session.requiresOrganizationSelection,
      expiresAt: result.session.accessTokenExpiresAt.toISOString(),
      // The one thing worth saying out loud: a spent recovery code is one the
      // user no longer has, and they should be told to print a new batch.
      usedRecoveryCode: result.usedRecoveryCode,
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
 * A wrong code, an expired challenge, an exhausted one and a challenge that
 * never existed all answer `AUTH_MFA_INVALID`.
 *
 * Distinguishing them would say how many attempts remain and whether a given
 * challenge id was ever real, which is a guessing aid. `NO_ACCESS` keeps its
 * own response for the same reason it does at login: it is a decision about
 * authorization, not a hint about a secret.
 */
function toVerificationException(error: unknown): unknown {
  if (error instanceof MfaError) {
    return new AppException('AUTH_MFA_INVALID');
  }

  if (error instanceof AuthenticationError) {
    return error.rejection === 'NO_ACCESS'
      ? new AppException('AUTH_TENANT_DENIED')
      : new AppException('AUTH_MFA_INVALID');
  }

  return error;
}

/** Truncated: the raw header is attacker-controlled and unbounded. */
function readUserAgent(request: Request): string | null {
  const raw = request.headers['user-agent'];

  return typeof raw === 'string' ? raw.slice(0, 255) : null;
}
