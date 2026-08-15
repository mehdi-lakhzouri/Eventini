import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import { InvitationRepository } from '../domain/invitation.repository';

@Injectable()
export class RevokeInvitationUseCase {
  constructor(private readonly invitations: InvitationRepository) {}

  /**
   * Rend `false` quand rien n'a été révoqué — invitation absente, appartenant
   * à une autre organisation, ou déjà consommée. Les trois se répondent à
   * l'identique : distinguer permettrait de sonder quels identifiants
   * d'invitation existent ailleurs.
   */
  async execute(
    context: TenantContext,
    invitationId: string,
  ): Promise<boolean> {
    return this.invitations.revoke(context, invitationId, context.userId);
  }
}
