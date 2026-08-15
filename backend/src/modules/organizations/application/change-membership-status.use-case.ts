import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import type { TenantContext } from '../../../common/types/tenant-context';
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
   * `security_events` n'a toujours pas d'écrivain — la table est vide et un
   * ticket dédié la construira face à l'ensemble de ses émetteurs. En
   * attendant, l'événement suit le même chemin que les autres.
   *
   * La trace qui fait autorité est `audit_logs`, écrite dans la transaction.
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
