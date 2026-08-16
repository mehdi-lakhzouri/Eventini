import { Module } from '@nestjs/common';

import {
  AuthenticationModule,
  AuthorizationModule,
  CsrfModule,
  PasswordsModule,
  SecurityEventsModule,
} from '../identity';
import { AuditModule } from '../audit';
import { ActivateOrganizationUseCase } from './application/activate-organization.use-case';
import { GetOrganizationUseCase } from './application/get-organization.use-case';
import { ListOrganizationsUseCase } from './application/list-organizations.use-case';
import { UpdateOrganizationUseCase } from './application/update-organization.use-case';
import { InvitationsController } from './controllers/invitations.controller';
import { MembersController } from './controllers/members.controller';
import { ChangeMembershipStatusUseCase } from './application/change-membership-status.use-case';
import { ListMembersUseCase } from './application/list-members.use-case';
import { ReplaceMemberRolesUseCase } from './application/replace-member-roles.use-case';
import { MemberRepository } from './domain/member.repository';
import { MembershipLifecycleRepository } from './domain/membership-lifecycle.repository';
import { PrismaMembershipLifecycleRepository } from './infrastructure/prisma-membership-lifecycle.repository';
import { PrismaMemberRepository } from './infrastructure/prisma-member.repository';
import { OrganizationsController } from './controllers/organizations.controller';
import { AcceptInvitationUseCase } from './application/accept-invitation.use-case';
import { InviteMemberUseCase } from './application/invite-member.use-case';
import { ListInvitationsUseCase } from './application/list-invitations.use-case';
import { RevokeInvitationUseCase } from './application/revoke-invitation.use-case';
import { InvitationRepository } from './domain/invitation.repository';
import { PrismaInvitationRepository } from './infrastructure/prisma-invitation.repository';
import { OrganizationRepository } from './domain/organization.repository';
import { PrismaOrganizationRepository } from './infrastructure/prisma-organization.repository';

/**
 * `AuthenticationModule` supplies `CallerResolver`, `SessionIssuer` and the
 * account lookup. The dependency runs one way — identity knows nothing about
 * organizations — so no `forwardRef` is needed and none should be added: a
 * cycle here would mean the authentication chain depended on the module whose
 * access it is supposed to decide.
 */
@Module({
  imports: [
    AuthenticationModule,
    AuthorizationModule,
    AuditModule,
    CsrfModule,
    PasswordsModule,
    SecurityEventsModule,
  ],
  controllers: [
    OrganizationsController,
    InvitationsController,
    MembersController,
  ],
  providers: [
    { provide: OrganizationRepository, useClass: PrismaOrganizationRepository },
    ListOrganizationsUseCase,
    ActivateOrganizationUseCase,
    GetOrganizationUseCase,
    UpdateOrganizationUseCase,
    { provide: InvitationRepository, useClass: PrismaInvitationRepository },
    InviteMemberUseCase,
    ListInvitationsUseCase,
    RevokeInvitationUseCase,
    AcceptInvitationUseCase,
    { provide: MemberRepository, useClass: PrismaMemberRepository },
    ListMembersUseCase,
    ReplaceMemberRolesUseCase,
    {
      provide: MembershipLifecycleRepository,
      useClass: PrismaMembershipLifecycleRepository,
    },
    ChangeMembershipStatusUseCase,
  ],
  exports: [OrganizationRepository],
})
export class OrganizationsModule {}
