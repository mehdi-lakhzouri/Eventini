import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import type { TenantContext } from '../../../common/types/tenant-context';
import { SecurityEventRecorder } from '../../identity';
import {
  MembershipLifecycleRepository,
  type LifecycleOutcome,
  type LifecycleRefusal,
} from '../domain/membership-lifecycle.repository';

interface Command {
  readonly context: TenantContext;
  readonly membershipId: string;
  readonly reason: string | null;
  readonly actorRole: string | null;
  readonly requestId: string | null;
  readonly ipAddress: string | null;
}

@Injectable()
export class ChangeMembershipStatusUseCase {
  constructor(
    private readonly lifecycle: MembershipLifecycleRepository,
    private readonly logger: PinoLogger,
    private readonly securityEvents: SecurityEventRecorder,
  ) {}

  async setSuspended(
    command: Command & { suspended: boolean },
  ): Promise<LifecycleOutcome | LifecycleRefusal> {
    const refusal = this.refuseSelfTarget(command);
    if (refusal !== null) {
      return refusal;
    }

    const result = await this.lifecycle.setSuspended(command.context, command);

    this.report(
      result,
      command,
      command.suspended ? 'MEMBERSHIP_SUSPENDED' : 'MEMBERSHIP_REACTIVATED',
    );

    return result;
  }

  async revoke(command: Command): Promise<LifecycleOutcome | LifecycleRefusal> {
    const refusal = this.refuseSelfTarget(command);
    if (refusal !== null) {
      return refusal;
    }

    const result = await this.lifecycle.revoke(command.context, command);

    this.report(result, command, 'MEMBERSHIP_REVOKED');

    if (typeof result !== 'string') {
      /*
        Émis ici, dans le use case, une fois `revoke` rendu — donc après le
        commit. Le repository, lui, écrit l'entrée d'audit **dans** la
        transaction : les deux traces ne répondent pas à la même question, et
        n'ont donc pas la même règle de placement. Voir
        `SecurityEventRepository`.
      */
      await this.securityEvents.recordForContext(
        'MEMBERSHIP_REVOKED',
        command.context,
        {
          requestId: command.requestId,
          ipAddress: command.ipAddress,
          reasonCode: 'REVOKED_BY_ADMINISTRATOR',
          // 🔴 Le membership retiré, pas celui de l'acteur — que le contexte
          // aurait rempli par défaut.
          membershipId: command.membershipId,
          metadata: {
            previousStatus: result.previousStatus,
            revokedSessions: result.revokedSessions,
            revokedEventAssignments: result.revokedEventAssignments,
            actorRole: command.actorRole,
          },
        },
      );
    }

    return result;
  }

  /**
   * 🔴 On ne se suspend ni ne se révoque soi-même.
   *
   * Couper sa propre session au milieu de l'opération est le moindre problème.
   * Le vrai est qu'une organisation à un seul administrateur se retrouverait
   * sans personne pour la rouvrir — et la réactivation exige justement le
   * droit qu'on vient de se retirer.
   */
  private refuseSelfTarget(command: Command): LifecycleRefusal | null {
    return command.membershipId === command.context.membershipId
      ? 'SELF_TARGET'
      : null;
  }

  /**
   * La ligne de log, qui reste **en plus** de l'événement de sécurité.
   *
   * Les deux catalogues sont des espaces de noms séparés (§10, ADR-0008) et
   * leurs lecteurs aussi : un tableau de bord interroge l'index de logs, une
   * enquête interroge PostgreSQL. Supprimer la ligne parce que la table existe
   * maintenant casserait le premier sans rien apporter au second.
   *
   * 🔴 La suspension et la réactivation n'ont **aucun type** dans le catalogue
   * de §8 : `MEMBERSHIP_REVOKED` y est, `MEMBERSHIP_SUSPENDED` non. Elles
   * restent donc en log et en audit uniquement, et ce n'est pas une omission de
   * ce ticket — c'est le catalogue qui n'a pas prévu le cas. Voir la note.
   */
  private report(
    result: LifecycleOutcome | LifecycleRefusal,
    command: Command,
    eventCode: string,
  ): void {
    if (typeof result === 'string') {
      return;
    }

    this.logger.info(
      {
        category: 'SECURITY',
        eventCode,
        organizationId: command.context.organizationId,
        membershipId: command.membershipId,
        actorUserId: command.context.userId,
        previousStatus: result.previousStatus,
        status: result.status,
        revokedSessions: result.revokedSessions,
        revokedEventAssignments: result.revokedEventAssignments,
      },
      'Membership status changed',
    );
  }
}
