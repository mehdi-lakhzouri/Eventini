import { Module } from '@nestjs/common';
import { AuthenticationModule } from './authentication';
import { AuthorizationModule } from './authorization';
import { CsrfModule } from './csrf';
import { InvitationsModule } from './invitations';
import { MfaModule } from './mfa';
import { PasswordsModule } from './passwords';
import { SecurityEventsModule } from './security-events';
import { IdentitySessionsModule } from './sessions';
import { TenantAccessModule } from './tenant-access';

@Module({
  imports: [
    AuthenticationModule,
    AuthorizationModule,
    CsrfModule,
    IdentitySessionsModule,
    InvitationsModule,
    MfaModule,
    PasswordsModule,
    SecurityEventsModule,
    TenantAccessModule,
  ],
  exports: [
    AuthenticationModule,
    AuthorizationModule,
    CsrfModule,
    IdentitySessionsModule,
    InvitationsModule,
    MfaModule,
    PasswordsModule,
    SecurityEventsModule,
    TenantAccessModule,
  ],
})
export class IdentityModule {}
