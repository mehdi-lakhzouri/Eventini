import { Module } from '@nestjs/common';

import { PrismaModule } from '../../src/infrastructure/database/prisma.module';
import { IdempotencyModule } from '../../src/modules/idempotency';
import { IdentityModule } from '../../src/modules/identity';
import { IdempotencyProbeController } from './idempotency-probe.controller';

/** Registers the probe route. Imported by the e2e suite, never by `AppModule`. */
@Module({
  imports: [PrismaModule, IdentityModule, IdempotencyModule],
  controllers: [IdempotencyProbeController],
})
export class IdempotencyProbeModule {}
