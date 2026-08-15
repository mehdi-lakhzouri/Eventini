import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import {
  InvitationRepository,
  type InvitationSummary,
} from '../domain/invitation.repository';

@Injectable()
export class ListInvitationsUseCase {
  constructor(private readonly invitations: InvitationRepository) {}

  async execute(context: TenantContext): Promise<InvitationSummary[]> {
    return this.invitations.listForOrganization(context);
  }
}
