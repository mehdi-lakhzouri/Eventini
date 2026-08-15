import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { authenticationConfig } from '../../../config/authentication.config';
import { PasswordHasher } from '../../identity';
import { hashInvitationToken } from '../domain/invitation-token';
import {
  InvitationRepository,
  type AcceptedInvitation,
  type InvitationRefusal,
} from '../domain/invitation.repository';

@Injectable()
export class AcceptInvitationUseCase {
  constructor(
    private readonly invitations: InvitationRepository,
    private readonly hasher: PasswordHasher,
    @Inject(authenticationConfig.KEY)
    private readonly authentication: ConfigType<typeof authenticationConfig>,
  ) {}

  /**
   * Consomme une invitation — EVT-043.
   *
   * `signedInNormalizedEmail` est l'adresse de la session en cours, s'il y en
   * a une. La route est publique : accepter une invitation est précisément ce
   * qu'on fait quand on n'a pas encore de compte.
   */
  async execute(input: {
    token: string;
    password: string | null;
    signedInNormalizedEmail: string | null;
  }): Promise<AcceptedInvitation | InvitationRefusal> {
    /*
      L'empreinte est calculée avant toute lecture : le jeton en clair ne
      touche jamais une requête, et un journal de requêtes lentes ne peut donc
      pas le capturer.
    */
    const tokenHash = hashInvitationToken(
      input.token,
      this.authentication.tokens.invitationSecret,
    );

    const invitation = await this.invitations.findByTokenHash(tokenHash);

    if (invitation === null) {
      /*
        Un seul refus pour « jeton inconnu », « déjà accepté », « révoqué » et
        « remplacé ». Les distinguer dirait à qui essaie des jetons au hasard
        lesquels ont existé — et le rate limit de 10 par heure ralentit un
        forçage sans le refermer.
      */
      return 'NOT_FOUND';
    }

    /*
      🔴 Session honorée — décision du 14 août 2026.

      Le jeton suffit. Mais si une session est ouverte, elle doit être celle de
      l'adresse invitée : sinon Ana, connectée, ouvre le lien destiné à Karim
      et le membership atterrit sur le compte d'Ana. C'est le piège le plus
      fréquent, et le plus déroutant, parce que tout paraît avoir fonctionné.

      Ne protège pas contre un jeton intercepté utilisé en navigation privée —
      ce cas-là exigerait une connexion préalable, écartée pour ne pas imposer
      un détour à chaque invité.
    */
    if (
      input.signedInNormalizedEmail !== null &&
      input.signedInNormalizedEmail !== invitation.normalizedEmail
    ) {
      return 'SESSION_MISMATCH';
    }

    const passwordHash =
      invitation.existingUserId === null && input.password !== null
        ? await this.hasher.hash(input.password)
        : null;

    return this.invitations.accept({ invitation, passwordHash });
  }
}
