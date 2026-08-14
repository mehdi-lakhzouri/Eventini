import { Module } from '@nestjs/common';

import { TenantContextService } from './tenant-context.service';

/**
 * Deliberately tiny, and with **no** dependency on `authorization`.
 *
 * MODULE_DEPENDENCY_MAP.md §3: `authorization → tenant-access`, never the
 * reverse — the tenant does not need permissions, and the reverse arrow is a
 * cycle. `TenantContextGuard` therefore lives in `authorization`, which is the
 * side allowed to know about both.
 */
@Module({
  providers: [TenantContextService],
  exports: [TenantContextService],
})
export class TenantAccessModule {}
