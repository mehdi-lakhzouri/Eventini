import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';

import { AppException } from '../../../../common/api/app-exception';
import { GetCurrentUserUseCase } from '../application/get-current-user.use-case';
import { toCallerException } from '../infrastructure/caller-exception.mapper';
import { CallerResolver } from '../infrastructure/caller.resolver';

/**
 * `GET /auth/me` — everything the currently signed-in caller is allowed to
 * know about their own account and session.
 *
 * A route of its own rather than a fourth thing on `SessionsController`:
 * that controller's routes all mutate or list sessions, this one reads a
 * profile, and the two would otherwise share nothing but the resolver call.
 */
@Controller('auth')
export class CurrentUserController {
  constructor(
    private readonly caller: CallerResolver,
    private readonly getCurrentUser: GetCurrentUserUseCase,
  ) {}

  @Get('me')
  async me(@Req() request: Request) {
    const caller = await this.caller
      .resolve(request)
      .catch((error: unknown) => {
        throw toCallerException(error);
      });

    const profile = await this.getCurrentUser.execute(caller.userId);

    // The token and the session both said this user exists; if the row is
    // gone now, the account was deleted mid-request. Answering the same way
    // as "not signed in" is correct — a fresh login will find out for real.
    if (profile === null) {
      throw new AppException('AUTHENTICATION_REQUIRED');
    }

    return {
      userId: profile.userId,
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      displayName: profile.displayName,
      status: profile.status,
      emailVerifiedAt: profile.emailVerifiedAt?.toISOString() ?? null,
      lastLoginAt: profile.lastLoginAt?.toISOString() ?? null,
      mfaEnabled: profile.hasActiveMfa,
      sessionId: caller.sessionId,
      organizationId: caller.organizationId,
      membershipId: caller.membershipId,
      clientType: caller.clientType,
      authenticationLevel: caller.authenticationLevel,
    };
  }
}
