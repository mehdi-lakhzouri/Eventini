import { Global, Logger, Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { databaseConfig } from '../../config/database.config';
import { PrismaService } from './prisma.service';
import { TENANT_SCOPED_PRISMA } from './prisma.tokens';
import {
  setUnscopedQueryReporter,
  withTenantScope,
  type TenantScopedPrismaClient,
} from './tenant-scope.extension';
import { TransactionManager } from './transaction.manager';

/**
 * Database access — sprint-03 EVT-014, tenant guard added by EVT-018.
 *
 * Global, because every feature module will need a client, and requiring
 * fifteen modules to remember an import is how one of them ends up
 * instantiating its own and quietly opening a second connection pool.
 *
 * `PrismaService` takes its settings through a factory rather than reading
 * configuration itself: that keeps it constructible in a test with a
 * throwaway database URL, without a Nest container.
 *
 * ## `PrismaService` is a provider but not an export, and that is the point
 *
 * It stays registered so Nest calls its `onModuleInit` / `onModuleDestroy`
 * hooks — connecting eagerly at boot, draining the pool on SIGTERM. It is
 * **not** exported, so no feature module can inject the unguarded client.
 *
 * ADR-0003's isolation is only as strong as the absence of a way around it,
 * and `$extends` leaves the original client fully working: a query issued
 * through it is invisible to the extension. That was verified against a live
 * client rather than assumed, because the whole guard rests on it. Exporting
 * `PrismaService` would have left every repository a one-word way to opt out,
 * and it would have looked like the obvious thing to type.
 *
 * What application code injects is `TENANT_SCOPED_PRISMA`.
 */
const unscopedQueryLogger = new Logger('TenantScope');

@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      inject: [databaseConfig.KEY],
      useFactory: (settings: ConfigType<typeof databaseConfig>) => {
        // Installed here rather than at import time: this is the first point
        // that runs once per application and has a logger.
        setUnscopedQueryReporter((model, operation, reason) => {
          unscopedQueryLogger.warn({
            category: 'SECURITY',
            eventCode: 'UNSCOPED_QUERY_EXECUTED',
            model,
            operation,
            unscopedReason: reason,
            msg: 'Tenant scope guard bypassed through $unscoped',
          });
        });

        return new PrismaService({
          url: settings.url,
          poolSize: settings.poolSize,
          connectTimeoutMs: settings.connectTimeoutMs,
          statementTimeoutMs: settings.statementTimeoutMs,
        });
      },
    },
    {
      provide: TENANT_SCOPED_PRISMA,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): TenantScopedPrismaClient =>
        withTenantScope(prisma),
    },
    TransactionManager,
  ],
  exports: [TENANT_SCOPED_PRISMA, TransactionManager],
})
export class PrismaModule {}
