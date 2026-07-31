import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Mounts interactive API documentation at `/api/v1/docs`.
 *
 * Gated by `SWAGGER_ENABLED`, which the production-hardening philosophy of
 * this codebase keeps `false` in production by convention — see
 * `docs/operations/ENVIRONMENT_VARIABLES.md` §16, though nothing in the
 * environment schema *forces* it off in production the way it forces
 * `COOKIE_SECURE` on. That asymmetry is deliberate: unlike an insecure
 * cookie, an exposed docs page is not on its own an exploitable
 * vulnerability, so a hard refusal is not warranted the way it is for the
 * production-hardening rule's other checks — but it must never leak a
 * secret. `AUTHENTICATION_AUTHORIZATION.md` §7 requires that no example ever
 * carries one; this builder adds none.
 *
 * Targets OpenAPI 3.1 per `API_CONVENTIONS.md` §12, though `@nestjs/swagger`
 * 11.x emits a 3.0-shaped document today (no routes or DTOs exist yet to
 * validate against). Full 3.1 compliance and the `docs/api/openapi.yaml` CI
 * gate are deferred to when real endpoints exist — recorded as a limitation,
 * not silently assumed complete.
 */
export function setupSwagger(app: INestApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Eventini API')
      .setDescription(
        'Multi-tenant event management and access control. See docs/ for the full specification.',
      )
      .setVersion('0.0.1')
      .addCookieAuth('__Host-eventini_access')
      .build(),
  );

  SwaggerModule.setup('api/v1/docs', app, document, {
    swaggerOptions: {
      // No token ever lives in a browser-accessible store (AUTH-INV-001);
      // Swagger's "Authorize" flow, which would want one, is intentionally
      // left unconfigured rather than encouraging a pattern this project
      // forbids everywhere else.
      persistAuthorization: false,
    },
  });
}
