import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../authentication/authentication.module';
import { TenantContextGuard } from './tenant-context.guard';
import { TenantContextService } from './tenant-context.service';

/**
 * `TenantContextGuard` is exported but **not** registered as an `APP_GUARD`
 * here: the chain's order is fixed in one place, `GuardChainModule`, so that a
 * reader sees the whole sequence at once rather than inferring it from where
 * each module happens to sit in an import list.
 */
@Module({
  imports: [AuthenticationModule],
  providers: [TenantContextGuard, TenantContextService],
  exports: [TenantContextGuard, TenantContextService],
})
export class TenantAccessModule {}
