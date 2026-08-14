import { Module } from '@nestjs/common';

import { RedisModule } from '../../../infrastructure/redis';
import { PermissionResolver } from './application/permission-resolver.service';
import { PermissionCache } from './domain/permission-cache';
import { PermissionRepository } from './domain/permission.repository';
import { PermissionsVersionStore } from './domain/permissions-version.store';
import { PrismaPermissionRepository } from './infrastructure/prisma-permission.repository';
import { RedisPermissionCache } from './infrastructure/redis-permission.cache';
import { RedisPermissionsVersionStore } from './infrastructure/redis-permissions-version.store';

/**
 * Step 6 of the authorization chain. The guard that consumes it arrives with
 * EVT-035; this module owns only the resolution and its cache, so the two can
 * be reasoned about — and tested — separately.
 */
@Module({
  imports: [RedisModule],
  providers: [
    { provide: PermissionRepository, useClass: PrismaPermissionRepository },
    { provide: PermissionCache, useClass: RedisPermissionCache },
    {
      provide: PermissionsVersionStore,
      useClass: RedisPermissionsVersionStore,
    },
    PermissionResolver,
  ],
  exports: [PermissionResolver, PermissionsVersionStore],
})
export class AuthorizationModule {}
