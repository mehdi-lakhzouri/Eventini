import { Injectable } from '@nestjs/common';

import {
  OrganizationRepository,
  type MembershipSummary,
} from '../domain/organization.repository';

/**
 * The organizations the caller may switch into.
 *
 * Needs no permission: the list *is* the caller's own memberships, so there is
 * nothing here they could not already learn by trying to activate each one.
 * Requiring a permission would mean a user with no organization role could not
 * discover the organization they belong to.
 */
@Injectable()
export class ListOrganizationsUseCase {
  constructor(private readonly organizations: OrganizationRepository) {}

  async execute(input: {
    userId: string;
    currentOrganizationId: string | null;
  }): Promise<MembershipSummary[]> {
    return this.organizations.listForUser(
      input.userId,
      input.currentOrganizationId,
    );
  }
}
