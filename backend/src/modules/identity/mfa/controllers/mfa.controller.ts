import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { AppException } from '../../../../common/api/app-exception';
import {
  CallerError,
  CallerResolver,
} from '../../authentication/infrastructure/caller.resolver';
import { BeginMfaEnrollmentUseCase } from '../application/begin-mfa-enrollment.use-case';
import { ConfirmMfaEnrollmentUseCase } from '../application/confirm-mfa-enrollment.use-case';
import { DisableMfaUseCase } from '../application/disable-mfa.use-case';
import { RegenerateRecoveryCodesUseCase } from '../application/regenerate-recovery-codes.use-case';
import { MfaError } from '../domain/mfa.errors';
import { ConfirmMfaEnrollmentDto } from '../dto/mfa.dto';

/**
 * Managing your own MFA methods. Every route here is authenticated and acts on
 * the caller's own account — the user id comes from the access token, never
 * from the path, so there is no object to make a reference to insecurely.
 */
@Controller('auth/mfa')
export class MfaController {
  constructor(
    private readonly beginEnrollment: BeginMfaEnrollmentUseCase,
    private readonly confirmEnrollment: ConfirmMfaEnrollmentUseCase,
    private readonly disableMethod: DisableMfaUseCase,
    private readonly regenerateCodes: RegenerateRecoveryCodesUseCase,
    private readonly caller: CallerResolver,
  ) {}

  /**
   * Returns the secret in the clear, once. It has to be — the user cannot
   * scan a QR code the server refuses to show them. Nothing is protected by
   * this method until the enrolment is confirmed, so a secret leaked here
   * guards nothing yet.
   */
  @Post('enrollments')
  @HttpCode(201)
  async begin(@Req() request: Request) {
    const { userId } = await this.resolveCaller(request);

    const enrollment = await this.beginEnrollment
      .execute({ userId })
      .catch((error: unknown) => {
        throw toMfaException(error);
      });

    return {
      enrollmentId: enrollment.methodId,
      secret: enrollment.secret,
      uri: enrollment.uri,
    };
  }

  /**
   * The enrolment only becomes active once a code proves the secret was
   * stored correctly. Activating on the strength of "the QR code was shown"
   * would lock users out of accounts they can no longer authenticate to.
   */
  @Post('enrollments/:enrollmentId/confirmation')
  @HttpCode(201)
  async confirm(
    @Param('enrollmentId') enrollmentId: string,
    @Body() body: ConfirmMfaEnrollmentDto,
    @Req() request: Request,
  ) {
    const { userId } = await this.resolveCaller(request);

    const recoveryCodes = await this.confirmEnrollment
      .execute({ userId, enrollmentId, code: body.code })
      .catch((error: unknown) => {
        throw toMfaException(error);
      });

    // The only time these are readable. They are stored hashed, so a user who
    // loses this response cannot be shown them again — only given new ones.
    return { recoveryCodes };
  }

  @Delete('methods/:methodId')
  @HttpCode(204)
  async disable(
    @Param('methodId') methodId: string,
    @Req() request: Request,
  ): Promise<void> {
    const { userId } = await this.resolveCaller(request);

    await this.disableMethod
      .execute({ userId, methodId })
      .catch((error: unknown) => {
        throw toMfaException(error);
      });
  }

  @Post('recovery-codes')
  @HttpCode(201)
  async regenerate(@Req() request: Request) {
    const { userId } = await this.resolveCaller(request);

    const recoveryCodes = await this.regenerateCodes
      .execute(userId)
      .catch((error: unknown) => {
        throw toMfaException(error);
      });

    return { recoveryCodes };
  }

  private async resolveCaller(request: Request) {
    return this.caller.resolve(request).catch((error: unknown) => {
      throw error instanceof CallerError
        ? new AppException('AUTHENTICATION_REQUIRED')
        : error;
    });
  }
}

function toMfaException(error: unknown): unknown {
  if (!(error instanceof MfaError)) {
    return error;
  }

  switch (error.rejection) {
    case 'INVALID_CODE':
      return new AppException('AUTH_MFA_INVALID');
    case 'NO_PENDING_ENROLLMENT':
    case 'NO_ACTIVE_METHOD':
    case 'ACCOUNT_UNKNOWN':
      return new AppException('RESOURCE_NOT_FOUND');
    case 'LAST_METHOD_REQUIRED':
      return new AppException('INVALID_STATE_TRANSITION', {
        detail: 'A SUPER_ADMIN must keep an active MFA method (INV-11).',
      });
    default:
      return new AppException('AUTH_MFA_INVALID');
  }
}
