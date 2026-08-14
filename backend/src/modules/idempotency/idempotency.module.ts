import { Module } from '@nestjs/common';

import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { IdempotencyRepository } from '../../common/idempotency/idempotency.repository';
import { IdempotencyRetentionPurger } from '../../common/idempotency/idempotency-retention';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaIdempotencyRepository } from '../../common/idempotency/prisma-idempotency.repository';
import { IdentityModule } from '../identity';

/**
 * Wiring, and only wiring — the mechanism itself lives in
 * `common/idempotency`, which imports nothing from `modules/`.
 *
 * `IdentityModule` is imported for one provider: the
 * `IdempotencyContextResolver` adapter over `CallerResolver`, which is what
 * turns a cookie into the `organizationId` and `actorId` the scope needs. It
 * is bound in `AuthenticationModule` rather than here, so this file never
 * reaches past another module's barrel.
 *
 * ## No route imports it yet
 *
 * The routes that require `Idempotency-Key` — check-in, offline sync,
 * participant imports, report exports, ticket generation — arrive in sprints
 * 09 to 12. The e2e suite's probe module is the only consumer today, and it
 * says so.
 */
@Module({
  imports: [IdentityModule],
  providers: [
    { provide: IdempotencyRepository, useClass: PrismaIdempotencyRepository },
    IdempotencyService,
    IdempotencyInterceptor,
    IdempotencyRetentionPurger,
  ],
  exports: [
    IdempotencyRepository,
    IdempotencyService,
    IdempotencyInterceptor,
    IdempotencyRetentionPurger,
  ],
})
export class IdempotencyModule {}
