import { Inject, Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import { TENANT_SCOPED_PRISMA } from '../../../infrastructure/database/prisma.tokens';
import type { TenantScopedPrismaClient } from '../../../infrastructure/database/tenant-scope.extension';
import { AuditRecorder } from '../../audit';
import { PermissionsVersionStore } from '../../identity';
import {
  MembershipLifecycleRepository,
  type LifecycleOutcome,
  type LifecycleRefusal,
} from '../domain/membership-lifecycle.repository';

/** Les états depuis lesquels chaque transition est permise. */
const SUSPENDABLE = new Set(['ACTIVE']);
const REACTIVATABLE = new Set(['SUSPENDED']);
const REVOCABLE = new Set(['ACTIVE', 'SUSPENDED']);

@Injectable()
export class PrismaMembershipLifecycleRepository extends MembershipLifecycleRepository {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA)
    private readonly prisma: TenantScopedPrismaClient,
    private readonly versions: PermissionsVersionStore,
    private readonly audit: AuditRecorder,
  ) {
    super();
  }

  async setSuspended(
    context: TenantContext,
    input: {
      membershipId: string;
      suspended: boolean;
      reason: string | null;
      actorRole: string | null;
      requestId: string | null;
      ipAddress: string | null;
    },
  ): Promise<LifecycleOutcome | LifecycleRefusal> {
    const current = await this.currentStatus(context, input.membershipId);

    if (current === null) {
      return 'NOT_FOUND';
    }

    const allowed = input.suspended ? SUSPENDABLE : REACTIVATABLE;

    if (!allowed.has(current)) {
      return 'INVALID_TRANSITION';
    }

    const status = input.suspended ? 'SUSPENDED' : 'ACTIVE';
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      await tx.organizationMembership.updateMany({
        where: {
          id: input.membershipId,
          organizationId: context.organizationId,
          // Le statut attendu est dans le `WHERE` : deux suspensions
          // concurrentes n'en appliquent qu'une, et c'est la base qui arbitre.
          status: current,
        },
        data: {
          status,
          suspendedAt: input.suspended ? now : null,
          suspendedBy: input.suspended ? context.userId : null,
          suspensionReason: input.suspended ? input.reason : null,
          updatedBy: context.userId,
        },
      });

      /*
        L'incrément même sur une suspension : l'étape 5 lit `membershipStatus`
        à chaque requête, mais les permissions résolues restent en cache sous
        l'ancienne version. Sans l'incrément, un membre réactivé attendrait le
        TTL avant de retrouver ses droits.
      */
      await this.versions.bumpMembership(input.membershipId);

      await this.audit.record(
        tx,
        context,
        {
          action: input.suspended
            ? 'membership.suspended'
            : 'membership.reactivated',
          targetType: 'organization_membership',
          targetId: input.membershipId,
          previousValues: { status: current },
          newValues: { status },
          reason: input.reason,
        },
        {
          requestId: input.requestId,
          ipAddress: input.ipAddress,
          actorRole: input.actorRole,
        },
      );

      return {
        membershipId: input.membershipId,
        previousStatus: current,
        status,
        revokedSessions: 0,
        revokedEventAssignments: 0,
      };
    });
  }

  async revoke(
    context: TenantContext,
    input: {
      membershipId: string;
      reason: string | null;
      actorRole: string | null;
      requestId: string | null;
      ipAddress: string | null;
    },
  ): Promise<LifecycleOutcome | LifecycleRefusal> {
    const current = await this.currentStatus(context, input.membershipId);

    if (current === null) {
      return 'NOT_FOUND';
    }

    if (!REVOCABLE.has(current)) {
      return 'INVALID_TRANSITION';
    }

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      await tx.organizationMembership.updateMany({
        where: {
          id: input.membershipId,
          organizationId: context.organizationId,
          status: current,
        },
        data: {
          status: 'REVOKED',
          revokedAt: now,
          revokedBy: context.userId,
          revocationReason: input.reason,
          updatedBy: context.userId,
        },
      });

      /*
        🔴 Les sessions dont ce membership est le contexte actif.

        L'étape 5 les refuserait de toute façon dès la requête suivante. Les
        couper en base fait deux choses de plus : le refresh token cesse de
        pouvoir en produire de nouvelles, et le départ devient visible dans la
        liste des sessions de l'intéressé plutôt que de rester un refus
        silencieux.
      */
      const sessions = await tx.userSession.updateMany({
        where: {
          activeMembershipId: input.membershipId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
        },
        data: { status: 'REVOKED', revokedAt: now, revokedBy: context.userId },
      });

      /*
        Les assignations d'événement sont `EVENT`-scopées et survivraient au
        membership qui les portait : un accès à un événement précis, sans plus
        aucun lien d'appartenance derrière lui.
      */
      const assignments = await tx.eventUserAssignment.updateMany({
        where: {
          membershipId: input.membershipId,
          organizationId: context.organizationId,
          revokedAt: null,
        },
        data: { revokedAt: now, revokedBy: context.userId, status: 'REVOKED' },
      });

      await this.versions.bumpMembership(input.membershipId);

      await this.audit.record(
        tx,
        context,
        {
          action: 'membership.revoked',
          targetType: 'organization_membership',
          targetId: input.membershipId,
          previousValues: { status: current },
          newValues: {
            status: 'REVOKED',
            revokedSessions: sessions.count,
            revokedEventAssignments: assignments.count,
          },
          reason: input.reason,
        },
        {
          requestId: input.requestId,
          ipAddress: input.ipAddress,
          actorRole: input.actorRole,
        },
      );

      return {
        membershipId: input.membershipId,
        previousStatus: current,
        status: 'REVOKED',
        revokedSessions: sessions.count,
        revokedEventAssignments: assignments.count,
      };
    });
  }

  /** Le statut courant, ou `null` si le membership n'est pas dans ce tenant. */
  private async currentStatus(
    context: TenantContext,
    membershipId: string,
  ): Promise<string | null> {
    const row = await this.prisma.organizationMembership.findFirst({
      where: {
        id: membershipId,
        organizationId: context.organizationId,
        deletedAt: null,
      },
      select: { status: true },
    });

    return row?.status ?? null;
  }
}
