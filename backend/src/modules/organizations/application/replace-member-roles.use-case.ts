import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import type { TenantContext } from '../../../common/types/tenant-context';
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
      return 'SELF_ASSIGNMENT';
    }

    const result = await this.members.replaceRoles(input.context, input);

    if (typeof result !== 'string') {
      /*
        `security_events` n'a pas encore d'écrivain — la table est vide et le
        ticket dédié la construira face à l'ensemble de ses émetteurs. En
        attendant, l'événement part par le même chemin que les trois autres
        événements de sécurité du dépôt.

        La trace qui fait autorité est ailleurs : `audit_logs`, écrite dans la
        transaction, contient déjà l'avant et l'après.
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
    }

    return result;
  }
}
