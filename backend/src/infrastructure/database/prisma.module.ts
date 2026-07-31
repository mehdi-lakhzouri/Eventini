import { Global, Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { databaseConfig } from '../../config/database.config';
import { PrismaService } from './prisma.service';
import { TransactionManager } from './transaction.manager';

/**
 * Database access — sprint-03 EVT-014.
 *
 * Global, because every feature module will need `PrismaService`, and
 * requiring fifteen modules to remember an import is how one of them ends up
 * instantiating its own client and quietly opening a second connection pool.
 *
 * `PrismaService` takes its settings through a factory rather than reading
 * configuration itself: that keeps it constructible in a test with a
 * throwaway database URL, without a Nest container.
 */
@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      inject: [databaseConfig.KEY],
      useFactory: (settings: ConfigType<typeof databaseConfig>) =>
        new PrismaService({
          url: settings.url,
          poolSize: settings.poolSize,
          connectTimeoutMs: settings.connectTimeoutMs,
          statementTimeoutMs: settings.statementTimeoutMs,
        }),
    },
    TransactionManager,
  ],
  exports: [PrismaService, TransactionManager],
})
export class PrismaModule {}
