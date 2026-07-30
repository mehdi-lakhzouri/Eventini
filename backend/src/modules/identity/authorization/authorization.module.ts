import { Module } from '@nestjs/common';
import { TenantAccessModule } from '../tenant-access';
import { PermissionsGuard } from './guards/permissions.guard';
import { ResourceAccessGuard } from './guards/resource-access.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [TenantAccessModule],
  providers: [PermissionsGuard, ResourceAccessGuard, RolesGuard],
  exports: [PermissionsGuard, ResourceAccessGuard, RolesGuard],
})
export class AuthorizationModule {}
