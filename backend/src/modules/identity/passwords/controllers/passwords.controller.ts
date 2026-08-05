import { Body, Controller, HttpCode, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';

import { AppException } from '../../../../common/api/app-exception';
import {
  CallerError,
  CallerResolver,
} from '../../authentication/infrastructure/caller.resolver';
import { ChangePasswordUseCase } from '../application/change-password.use-case';
import { RequestPasswordResetUseCase } from '../application/request-password-reset.use-case';
import { ResetPasswordUseCase } from '../application/reset-password.use-case';
import { PasswordFlowError } from '../domain/password.errors';
import { PasswordPolicyError } from '../domain/password.policy';
import {
  ChangePasswordDto,
  RequestPasswordResetDto,
  ResetPasswordDto,
} from '../dto/password.dto';

@Controller('auth')
export class PasswordsController {
  constructor(
    private readonly requestReset: RequestPasswordResetUseCase,
    private readonly resetPassword: ResetPasswordUseCase,
    private readonly changePassword: ChangePasswordUseCase,
    private readonly caller: CallerResolver,
  ) {}

  /**
   * Always `202`, with the same body, whether or not the address belongs to
   * anyone. Answering differently would turn this endpoint into a register of
   * which email addresses have accounts — and it is unauthenticated.
   */
  @Post('password-reset-requests')
  @HttpCode(202)
  async request(
    @Body() body: RequestPasswordResetDto,
    @Req() request: Request,
  ): Promise<{ accepted: true }> {
    await this.requestReset.execute({
      email: body.email,
      requestedIp: request.ip ?? null,
    });

    // The token is deliberately not returned. Delivery is the mail module's
    // job (EVT-033); until it exists the link is unreachable from here, which
    // is the safe direction to be incomplete in.
    return { accepted: true };
  }

  @Post('password-resets')
  @HttpCode(204)
  async reset(@Body() body: ResetPasswordDto): Promise<void> {
    await this.resetPassword
      .execute({ token: body.token, newPassword: body.newPassword })
      .catch((error: unknown) => {
        throw toPasswordException(error);
      });
  }

  @Put('password')
  @HttpCode(204)
  async change(
    @Body() body: ChangePasswordDto,
    @Req() request: Request,
  ): Promise<void> {
    const caller = await this.caller
      .resolve(request)
      .catch((error: unknown) => {
        throw error instanceof CallerError
          ? new AppException('AUTHENTICATION_REQUIRED')
          : error;
      });

    await this.changePassword
      .execute({
        userId: caller.userId,
        currentSessionId: caller.sessionId,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
      })
      .catch((error: unknown) => {
        throw toPasswordException(error);
      });
  }
}

/**
 * An expired token, a consumed token and a token that never existed all
 * answer the same way. Distinguishing them tells a holder of a stale link
 * whether it was ever real, which is a fact about someone else's mailbox.
 */
function toPasswordException(error: unknown): unknown {
  if (error instanceof PasswordPolicyError) {
    return new AppException('VALIDATION_ERROR', {
      detail: `Password rejected: ${error.violation}`,
      errors: [{ field: 'newPassword', code: error.violation, message: '' }],
    });
  }

  if (!(error instanceof PasswordFlowError)) {
    return error;
  }

  return error.rejection === 'WRONG_CURRENT_PASSWORD'
    ? new AppException('AUTH_INVALID_CREDENTIALS')
    : new AppException('AUTHENTICATION_REQUIRED');
}
