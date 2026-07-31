import { ValidationPipe } from '@nestjs/common';

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
 */
export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: false,
    },
  });
}
