import { Module } from '@nestjs/common';

import { AuthenticationModule, CsrfModule } from '../identity';
import { ActivateOrganizationUseCase } from './application/activate-organization.use-case';
import { GetOrganizationUseCase } from './application/get-organization.use-case';
import { ListOrganizationsUseCase } from './application/list-organizations.use-case';
import { UpdateOrganizationUseCase } from './application/update-organization.use-case';
import { OrganizationsController } from './controllers/organizations.controller';
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
  imports: [AuthenticationModule, CsrfModule],
  controllers: [OrganizationsController],
  providers: [
    { provide: OrganizationRepository, useClass: PrismaOrganizationRepository },
    ListOrganizationsUseCase,
    ActivateOrganizationUseCase,
    GetOrganizationUseCase,
    UpdateOrganizationUseCase,
  ],
  exports: [OrganizationRepository],
})
export class OrganizationsModule {}
