import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../authentication/authentication.module';
import { TenantAccessModule } from '../tenant-access';
import { AuthorizationModule } from './authorization.module';
import { AUTHORIZATION_GUARDS } from './guards';

/**
 * Registers the guard chain, and exists as its own module purely to fix the
 * order.
 *
 * Nest runs `APP_GUARD` providers in the order their modules initialise.
 * Registering these inside `AuthorizationModule` would place them wherever
 * `IdentityModule`'s import list happens to put it — which is alphabetically
 * ahead of `CsrfModule`, so permissions would be checked before CSRF. Nothing
 * in that arrangement would look wrong while reading either file.
 *
 * `AppModule` imports this after `IdentityModule`, which puts the chain behind
 * rate limiting and CSRF where §7.5 requires it. `guard-order.e2e-spec.ts`
 * asserts the resulting behaviour rather than trusting the import list to stay
 * as it is.
 */
@Module({
  imports: [AuthenticationModule, TenantAccessModule, AuthorizationModule],
  providers: [...AUTHORIZATION_GUARDS],
})
export class GuardChainModule {}
