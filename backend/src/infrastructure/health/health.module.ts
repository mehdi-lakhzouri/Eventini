import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { HealthIndicatorService, TerminusModule } from '@nestjs/terminus';

import { redisConfig } from '../../config/redis.config';
import { DatabaseHealthIndicator } from './database.health-indicator';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './redis.health-indicator';
import { StartupState } from './startup.state';

/**
 * Health probes — sprint-02 EVT-012.
 *
 * Not `@Global()`, unlike logging and metrics: nothing else in the
 * application should be asking the health module anything. A use case that
 * wants to know whether Redis is up has a design problem, not a missing
 * import — it should handle the failure where it occurs.
 *
 * The indicators take their connection strings through factories rather than
 * reading config themselves, which is what makes them unit-testable against a
 * fake dependency without a container.
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [
    StartupState,
    // Takes `PrismaService` by injection now that EVT-014 provides it, rather
    // than the connection string it used to open a private pool with.
    DatabaseHealthIndicator,
    {
      provide: RedisHealthIndicator,
      inject: [HealthIndicatorService, redisConfig.KEY],
      useFactory: (
        indicatorService: HealthIndicatorService,
        settings: ConfigType<typeof redisConfig>,
      ) => new RedisHealthIndicator(indicatorService, settings.url),
    },
  ],
})
export class HealthModule {}
