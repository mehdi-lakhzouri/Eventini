import { ValidationPipe } from '@nestjs/common';

import { AppException, flattenValidationErrors } from '../common/api';

/**
 * The two non-negotiable settings from BACKEND_ARCHITECTURE.md §4:
 *
 * `forbidNonWhitelisted: true` — a request body carrying an unexpected field
 * (`{"status":"ACTIVE"}` slipped into a create payload) is REJECTED, not
 * silently stripped. `whitelist: true` alone would strip it and let the
 * request through, hiding the mass-assignment attempt instead of refusing it
 * (OWASP API3).
 *
 * `enableImplicitConversion: false` — implicit conversion turns `"0"` into
 * `false` and similar surprises. Each DTO declares its own types explicitly
 * instead.
 *
 * `exceptionFactory` — without it, a failed DTO validates into Nest's own
 * `BadRequestException`, shaped `{statusCode, message: string[], error}`,
 * which is not the RFC 9457 envelope every other error in the API carries.
 * Raising an `AppException` here instead means `HttpExceptionFilter` handles
 * it exactly like any other application error, with per-field `errors[]`.
 */
export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: false,
    },
    exceptionFactory: (errors) =>
      new AppException('VALIDATION_ERROR', {
        errors: flattenValidationErrors(errors),
      }),
  });
}
