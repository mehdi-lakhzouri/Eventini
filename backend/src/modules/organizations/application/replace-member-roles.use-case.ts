import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import type { TenantContext } from '../../../common/types/tenant-context';
import { SecurityEventRecorder } from '../../identity';
import {
  MemberRepository,
  type RoleChangeOutcome,
  type RoleChangeRefusal,
} from '../domain/member.repository';

@Injectable()
export class ReplaceMemberRolesUseCase {
  constructor(
    private readonly members: MemberRepository,
    private readonly logger: PinoLogger,
    private readonly securityEvents: SecurityEventRecorder,
  ) {}

  async execute(input: {
    context: TenantContext;
    membershipId: string;
    roleCodes: readonly string[];
    actorRole: string | null;
    requestId: string | null;
    ipAddress: string | null;
  }): Promise<RoleChangeOutcome | RoleChangeRefusal> {
    /*
      🔴 On ne modifie pas ses propres rôles.

      Un administrateur qui se retire `users.manage_roles` se verrouille dehors
      sans recours, et un administrateur qui s'en ajoute contourne toute revue.
      Le second est le cas qui compte : c'est une élévation de privilège en une
      requête, par quelqu'un qui a déjà le droit d'en accorder aux autres.
    */
    if (input.membershipId === input.context.membershipId) {
      /*
        🔴 Une auto-assignation refusée est une tentative d'élévation de
        privilège, et elle est enregistrée comme telle — par quelqu'un
        d'authentifié, qui détient déjà `users.manage_roles`, et dont la requête
        n'a rien d'accidentel. C'est le seul refus de ce use case qui écrive
        dans `security_events` : les trois autres sont des erreurs d'appel.

        Émis avant le `return` et sans transaction en jeu : rien n'a été écrit,
        c'est précisément le genre d'événement qu'une transaction ferait
        disparaître.
      */
      await this.securityEvents.recordForContext(
        'ROLE_ESCALATION_ATTEMPTED',
        input.context,
        {
          requestId: input.requestId,
          ipAddress: input.ipAddress,
          reasonCode: 'SELF_ROLE_ASSIGNMENT',
          metadata: {
            requestedRoleCodes: [...input.roleCodes],
            actorRole: input.actorRole,
          },
        },
      );

      return 'SELF_ASSIGNMENT';
    }

    const result = await this.members.replaceRoles(input.context, input);

    if (typeof result !== 'string') {
      /*
        La ligne de log reste : les deux catalogues sont des espaces de noms
        séparés (§10, ADR-0008), lus par des outils différents. La trace qui
        fait autorité sur le **contenu** du changement demeure `audit_logs`,
        écrite dans la transaction avec l'avant et l'après.
      */
      this.logger.info(
        {
          category: 'SECURITY',
          eventCode: 'ROLE_CHANGED',
          organizationId: input.context.organizationId,
          membershipId: input.membershipId,
          actorUserId: input.context.userId,
          previousRoleCodes: result.previousRoleCodes,
          roleCodes: result.roleCodes,
        },
        'Membership roles replaced',
      );

      await this.securityEvents.recordForContext(
        'ROLE_CHANGED',
        input.context,
        {
          requestId: input.requestId,
          ipAddress: input.ipAddress,
          // Le membership modifié, pas celui de l'acteur.
          membershipId: input.membershipId,
          metadata: {
            previousRoleCodes: [...result.previousRoleCodes],
            roleCodes: [...result.roleCodes],
            actorRole: input.actorRole,
          },
        },
      );
    }

    return result;
  }
}
