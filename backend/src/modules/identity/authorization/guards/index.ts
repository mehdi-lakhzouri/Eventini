import { APP_GUARD } from '@nestjs/core';
import type { Provider } from '@nestjs/common';

import { TenantContextGuard } from '../../tenant-access/tenant-context.guard';
import { AuthenticationGuard } from './authentication.guard';
import { PermissionsGuard } from './permissions.guard';

export { AuthenticationGuard } from './authentication.guard';
export { PermissionsGuard } from './permissions.guard';

/**
 * The chain, in the order §4 fixes it — and the order is load-bearing.
 *
 * Nest runs `APP_GUARD` providers in registration order, so listing them in one
 * array is what guarantees it. Spreading them across modules would leave the
 * order to be an accident of import sequence, which is exactly how a
 * permission check ends up running before the session it depends on.
 *
 * Rate limiting and CSRF come first, registered by their own modules ahead of
 * this one:
 *
 *   RateLimit → Csrf → Authentication → TenantContext → Permissions
 *
 * Steps 7 and 8 — resource ownership and resource state — are deliberately not
 * here. They cannot be: deciding them means loading the resource, which is the
 * use case's job. They are carried by repository methods that *require* a
 * `TenantContext`, which is why that type exists and why the architecture test
 * refuses a repository without it.
 */
export const AUTHORIZATION_GUARDS: readonly Provider[] = [
  { provide: APP_GUARD, useClass: AuthenticationGuard },
  { provide: APP_GUARD, useClass: TenantContextGuard },
  { provide: APP_GUARD, useClass: PermissionsGuard },
];
