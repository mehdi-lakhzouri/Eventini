import { Module } from '@nestjs/common';

import { RedisModule } from '../../../infrastructure/redis';
import { AuthorizationContextReader } from '../authentication/domain/authorization-context.reader';
import { PermissionResolver } from './application/permission-resolver.service';
import { PermissionCache } from './domain/permission-cache';
import { PermissionRepository } from './domain/permission.repository';
import { PermissionsVersionStore } from './domain/permissions-version.store';
import { PrismaPermissionRepository } from './infrastructure/prisma-permission.repository';
import { RedisPermissionCache } from './infrastructure/redis-permission.cache';
import { RedisPermissionsVersionStore } from './infrastructure/redis-permissions-version.store';
import { ResolvedAuthorizationContextReader } from './infrastructure/resolved-authorization-context.reader';

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
    {
      provide: AuthorizationContextReader,
      useClass: ResolvedAuthorizationContextReader,
    },
  ],
  /*
    `AuthorizationContextReader` est exporté pour que `AuthenticationModule`
    puisse l'injecter dans `GET /auth/me`.

    L'arête `authentication → authorization` que cela crée au niveau des
    modules Nest **ne referme pas de cycle** : ce module n'importe que
    `RedisModule`. C'est `GuardChainModule`, un module distinct, qui dépend de
    `AuthenticationModule` — la séparation entre les deux est précisément ce
    qui rend cette exportation possible.
  */
  exports: [
    PermissionResolver,
    PermissionsVersionStore,
    AuthorizationContextReader,
  ],
})
export class AuthorizationModule {}
