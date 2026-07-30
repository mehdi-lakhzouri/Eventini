import { Module } from '@nestjs/common';
import { TenantContextGuard } from './tenant-context.guard';
import { TenantContextService } from './tenant-context.service';
import { TenantMembershipService } from './tenant-membership.service';

@Module({
  providers: [
    TenantContextGuard,
    TenantContextService,
    TenantMembershipService,
  ],
  exports: [TenantContextGuard, TenantContextService, TenantMembershipService],
})
export class TenantAccessModule {}
