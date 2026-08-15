import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { AppException } from '../../../common/api/app-exception';
import { Public } from '../../../common/decorators';
import type { TenantContext } from '../../../common/types/tenant-context';
import { normalizeEmail } from '../../../infrastructure/database/normalize-email';
import {
  AuthenticationRepository,
  CallerResolver,
  CurrentContext,
  RequirePermission,
} from '../../identity';
import { AcceptInvitationUseCase } from '../application/accept-invitation.use-case';
import { InviteMemberUseCase } from '../application/invite-member.use-case';
import { ListInvitationsUseCase } from '../application/list-invitations.use-case';
import { RevokeInvitationUseCase } from '../application/revoke-invitation.use-case';
import type { InvitationSummary } from '../domain/invitation.repository';
import {
  AcceptInvitationDto,
  CreateInvitationDto,
} from '../dto/invitation.dto';

/**
 * Les invitations d'organisation — EVT-043.
 *
 * L'acceptation vit sous `/auth`, pas sous `/organizations/{id}` : elle
 * précède toute session, donc il n'existe aucun contexte tenant pour la
 * scoper. La ranger sous une organisation obligerait un invité sans compte à
 * nommer l'organisation qu'il rejoint — information qu'il n'a pas, et qui
 * transformerait la route en moyen de sonder quelles organisations existent.
 */
@Controller()
export class InvitationsController {
  constructor(
    private readonly invite: InviteMemberUseCase,
    private readonly list: ListInvitationsUseCase,
    private readonly revoke: RevokeInvitationUseCase,
    private readonly accept: AcceptInvitationUseCase,
    private readonly caller: CallerResolver,
    private readonly accounts: AuthenticationRepository,
  ) {}

  /**
   * `POST /organizations/{organizationId}/invitations`
   *
   * 🔴 La réponse est **identique** que l'adresse ait déjà un compte ou non.
   * Distinguer ferait de cette route un registre des adresses inscrites sur la
   * plateforme, interrogeable par n'importe quel administrateur d'une
   * organisation quelconque.
   */
  @Post('organizations/:organizationId/invitations')
  @RequirePermission('users.invite')
  @HttpCode(201)
  async create(
    @CurrentContext() context: TenantContext,
    @Body() body: CreateInvitationDto,
  ) {
    const result = await this.invite.execute({
      context,
      email: body.email,
      roleCode: body.roleCode,
    });

    if (result === 'UNKNOWN_ROLE') {
      /*
        Un rôle `PLATFORM` demandé ici tombe dans la même branche qu'un rôle
        inexistant, et c'est délibéré : répondre « ce rôle existe mais vous n'y
        avez pas droit » énumérerait le catalogue plateforme.
      */
      throw new AppException('VALIDATION_ERROR', {
        detail: 'Unknown role for this organization.',
        errors: [
          {
            field: 'roleCode',
            code: 'UNKNOWN_ROLE',
            message: 'This role cannot be assigned here.',
          },
        ],
      });
    }

    return {
      ...presentInvitation(result.invitation),
      /*
        🔴 Le jeton, rendu **une seule fois**. En attendant l'envoi d'emails
        (EVT-073), c'est le seul moyen de transmettre le lien.

        Conséquence assumée : l'invitant le voit, donc il peut accepter
        l'invitation à la place de l'invité, depuis n'importe quelle adresse.
        La possession du jeton cesse de prouver le contrôle de la boîte mail.
        `GET` ne le renvoie jamais.
      */
      acceptanceToken: result.acceptanceToken,
    };
  }

  /** `GET /organizations/{organizationId}/invitations` */
  @Get('organizations/:organizationId/invitations')
  @RequirePermission('users.invite')
  async index(@CurrentContext() context: TenantContext) {
    const invitations = await this.list.execute(context);

    // Le jeton n'est pas dans `InvitationSummary`, donc il ne peut pas fuiter
    // ici par inadvertance : seule son empreinte existe en base.
    return invitations.map(presentInvitation);
  }

  /** `DELETE /organizations/{organizationId}/invitations/{invitationId}` */
  @Delete('organizations/:organizationId/invitations/:invitationId')
  @RequirePermission('users.invite')
  @HttpCode(204)
  async destroy(
    @CurrentContext() context: TenantContext,
    @Param('invitationId') invitationId: string,
  ): Promise<void> {
    const revoked = await this.revoke.execute(context, invitationId);

    if (!revoked) {
      throw new AppException('RESOURCE_NOT_FOUND', {
        detail: 'No pending invitation with this identifier.',
      });
    }
  }

  /**
   * `POST /auth/invitation-acceptances`
   *
   * Publique : accepter une invitation est exactement ce qu'on fait quand on
   * n'a pas encore de compte. La limitation de débit s'applique par IP —
   * `RATE_LIMITING_AND_ABUSE_PREVENTION.md` la classe parmi les routes
   * sensibles non authentifiées, au même titre que la connexion.
   */
  @Public()
  @Post('auth/invitation-acceptances')
  @HttpCode(201)
  async acceptInvitation(
    @Body() body: AcceptInvitationDto,
    @Req() request: Request,
  ) {
    const result = await this.accept.execute({
      token: body.token,
      password: body.password ?? null,
      signedInNormalizedEmail: await this.signedInEmail(request),
    });

    if (typeof result === 'string') {
      throw acceptanceException(result);
    }

    /*
      Aucune session n'est ouverte ici. L'invité se connecte ensuite par la
      route normale : émettre une session depuis une route publique
      contournerait la limitation de débit de la connexion et la porte MFA, et
      donnerait à un jeton d'invitation le pouvoir d'un mot de passe.
    */
    return {
      organizationId: result.organizationId,
      membershipId: result.membershipId,
    };
  }

  /**
   * L'adresse de la session en cours, ou `null`.
   *
   * Une session absente ou invalide n'est **pas** une erreur : la route est
   * publique. La résolution sert seulement à détecter le cas où quelqu'un
   * accepte, connecté, une invitation qui ne lui est pas destinée.
   */
  private async signedInEmail(request: Request): Promise<string | null> {
    const caller = await this.caller.resolve(request).catch(() => null);

    if (caller === null) {
      return null;
    }

    const profile = await this.accounts.findProfileById(caller.userId);

    return profile === null ? null : normalizeEmail(profile.email);
  }
}

function presentInvitation(invitation: InvitationSummary) {
  return {
    invitationId: invitation.invitationId,
    email: invitation.email,
    status: invitation.status,
    roleCode: invitation.roleCode,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
    acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
  };
}

function acceptanceException(refusal: string): AppException {
  switch (refusal) {
    case 'SESSION_MISMATCH':
      return new AppException('RESOURCE_ALREADY_EXISTS', {
        detail:
          'You are signed in as a different account. Sign out before accepting this invitation.',
      });

    case 'ALREADY_MEMBER':
      return new AppException('RESOURCE_ALREADY_EXISTS', {
        detail: 'This account already belongs to the organization.',
      });

    case 'PASSWORD_REQUIRED':
      return new AppException('VALIDATION_ERROR', {
        detail: 'A password is required to create the account.',
        errors: [
          {
            field: 'password',
            code: 'REQUIRED',
            message: 'Choose a password for your new account.',
          },
        ],
      });

    default:
      /*
        `NOT_FOUND`, `EXPIRED` et `ALREADY_USED` se répondent à l'identique.
        Les distinguer dirait à qui essaie des jetons au hasard lesquels ont
        existé, et lesquels existent encore.
      */
      return new AppException('RESOURCE_NOT_FOUND', {
        detail: 'This invitation is no longer valid.',
      });
  }
}
