import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { authenticationConfig } from '../../../config/authentication.config';
import { normalizeEmail } from '../../../infrastructure/database/normalize-email';
import type { TenantContext } from '../../../common/types/tenant-context';
import { issueInvitationToken } from '../domain/invitation-token';
import {
  InvitationRepository,
  type InvitationSummary,
} from '../domain/invitation.repository';

export type InviteRefusal = 'UNKNOWN_ROLE';

export interface IssuedInvitation {
  readonly invitation: InvitationSummary;
  /**
   * Le jeton en clair, rendu **une seule fois**.
   *
   * 🔴 Décision produit du 14 août 2026, en attendant l'envoi d'emails
   * (EVT-073, sprint 12). Conséquence assumée : l'invitant voit le jeton, donc
   * il peut accepter l'invitation à la place de l'invité, depuis n'importe
   * quelle adresse. La possession du jeton ne prouve plus le contrôle de la
   * boîte mail. L'audit d'EVT-044 enregistrera qui a réellement accepté.
   */
  readonly acceptanceToken: string;
}

@Injectable()
export class InviteMemberUseCase {
  constructor(
    private readonly invitations: InvitationRepository,
    @Inject(authenticationConfig.KEY)
    private readonly authentication: ConfigType<typeof authenticationConfig>,
  ) {}

  async execute(input: {
    context: TenantContext;
    email: string;
    roleCode: string;
  }): Promise<IssuedInvitation | InviteRefusal> {
    const role = await this.invitations.findAssignableRole(input.roleCode);

    if (role === null) {
      return 'UNKNOWN_ROLE';
    }

    const { token, tokenHash } = issueInvitationToken(
      this.authentication.tokens.invitationSecret,
    );

    const invitation = await this.invitations.create(input.context, {
      email: input.email.trim(),
      normalizedEmail: normalizeEmail(input.email),
      roleId: role.roleId,
      tokenHash,
      // `lifetimes.invitation` est en secondes, comme toutes les durées de
      // cette configuration — 7 jours par défaut (`INVITATION_TTL=7d`).
      expiresAt: new Date(
        Date.now() + this.authentication.lifetimes.invitation * 1000,
      ),
      invitedBy: input.context.userId,
    });

    return { invitation, acceptanceToken: token };
  }
}
