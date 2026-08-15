import { Inject, Injectable } from '@nestjs/common';

import {
  ID_PREFIXES,
  newId,
} from '../../../infrastructure/database/identifiers';
import type { TenantContext } from '../../../common/types/tenant-context';
import { TENANT_SCOPED_PRISMA } from '../../../infrastructure/database/prisma.tokens';
import type { TenantScopedPrismaClient } from '../../../infrastructure/database/tenant-scope.extension';
import { PermissionsVersionStore } from '../../identity';
import { AuditRecorder } from '../../audit';
import {
  MemberRepository,
  type MemberSummary,
  type RoleChangeOutcome,
  type RoleChangeRefusal,
} from '../domain/member.repository';

@Injectable()
export class PrismaMemberRepository extends MemberRepository {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA)
    private readonly prisma: TenantScopedPrismaClient,
    private readonly versions: PermissionsVersionStore,
    private readonly audit: AuditRecorder,
  ) {
    super();
  }

  /**
   * Les membres de l'organisation active.
   *
   * Chaque colonne est nommée. Un `select` implicite embarquerait
   * `password_hash` par la relation `user`, et une relecture de revue ne le
   * verrait pas — c'est précisément le genre de fuite qui ne ressemble à rien
   * dans un diff.
   */
  async listMembers(context: TenantContext): Promise<MemberSummary[]> {
    const rows = await this.prisma.organizationMembership.findMany({
      where: { organizationId: context.organizationId, deletedAt: null },
      select: {
        id: true,
        userId: true,
        status: true,
        joinedAt: true,
        user: {
          select: {
            primaryEmail: true,
            firstName: true,
            lastName: true,
            displayName: true,
            mfaMethods: {
              where: { status: 'ACTIVE' },
              select: { id: true },
              take: 1,
            },
          },
        },
        roleAssignments: {
          where: { revokedAt: null },
          select: { role: { select: { code: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => ({
      membershipId: row.id,
      userId: row.userId,
      email: row.user.primaryEmail,
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      displayName: row.user.displayName,
      status: row.status,
      // Un booléen, pas la liste des méthodes : l'écran a besoin de savoir que
      // le second facteur est actif, pas lequel.
      mfaEnabled: row.user.mfaMethods.length > 0,
      joinedAt: row.joinedAt,
      roleCodes: row.roleAssignments.map((assignment) => assignment.role.code),
    }));
  }

  async replaceRoles(
    context: TenantContext,
    input: {
      membershipId: string;
      roleCodes: readonly string[];
      actorRole: string | null;
      requestId: string | null;
      ipAddress: string | null;
    },
  ): Promise<RoleChangeOutcome | RoleChangeRefusal> {
    const { membershipId } = input;
    const wanted = [...new Set(input.roleCodes)];

    /*
      Résolution des codes AVANT la transaction : une transaction ouverte
      pendant qu'on valide des entrées est une transaction qui tient des verrous
      pour rien. Le filtre de portée est dans le `WHERE` — un rôle `PLATFORM`
      ne remonte pas, donc il tombe dans la même branche qu'un code inexistant.
    */
    const roles = await this.prisma.$unscoped(
      'Read the global role catalogue, which has no organization_id (EVT-044)',
      () =>
        this.prisma.role.findMany({
          where: { code: { in: wanted }, scope: 'ORGANIZATION' },
          select: { id: true, code: true },
        }),
    );

    if (roles.length !== wanted.length) {
      return 'UNKNOWN_ROLE';
    }

    const membership = await this.prisma.organizationMembership.findFirst({
      where: {
        id: membershipId,
        organizationId: context.organizationId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (membership === null) {
      return 'NOT_FOUND';
    }

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.membershipRoleAssignment.findMany({
        where: {
          membershipId,
          organizationId: context.organizationId,
          revokedAt: null,
        },
        select: { id: true, roleId: true, role: { select: { code: true } } },
      });

      const previousRoleCodes = current.map((row) => row.role.code);
      const wantedIds = new Set(roles.map((role) => role.id));

      const removed = current.filter((row) => !wantedIds.has(row.roleId));
      const added = roles.filter(
        (role) => !current.some((row) => row.roleId === role.id),
      );

      if (removed.length > 0) {
        // `revoked_at`, jamais `DELETE` : qui a tenu quel rôle et jusqu'à quand
        // est exactement ce qu'un auditeur vient chercher.
        await tx.membershipRoleAssignment.updateMany({
          /*
            `organizationId` en plus des identifiants, et ce n'est pas
            décoratif : la garde tenant a refusé la première version de cette
            requête, où le `where` ne portait que `id: { in: [...] }`. Elle
            avait raison — les identifiants viennent d'une lecture scopée, mais
            rien dans la requête d'écriture ne le disait, et la règle d'ADR-0003
            ne fait pas d'exception pour « je sais que c'est sûr ».
          */
          where: {
            id: { in: removed.map((row) => row.id) },
            organizationId: context.organizationId,
          },
          data: { revokedAt: new Date(), revokedBy: context.userId },
        });
      }

      for (const role of added) {
        /*
          Insertion une par une plutôt qu'un `createMany` : le trigger INV-09
          lève sur la ligne fautive, et une insertion groupée annulerait le lot
          entier en désignant mal la cause. Le nombre de rôles par membership se
          compte sur les doigts d'une main.
        */
        await tx.membershipRoleAssignment.create({
          data: {
            id: newId(ID_PREFIXES.assignment),
            membershipId,
            organizationId: context.organizationId,
            roleId: role.id,
            assignedBy: context.userId,
          },
        });
      }

      /*
        🔴 L'incrément AVANT le commit, et dans la transaction.

        Le compteur vit dans Redis, donc il n'est pas transactionnel avec
        PostgreSQL — l'ordre est ce qui rend l'échec inoffensif. Ici, un
        rollback laisse une version avancée pour rien : un cache manqué, une
        relecture en base, aucune conséquence. L'ordre inverse laisserait un
        changement commité avec un cache périmé, c'est-à-dire un rôle révoqué
        qui continue d'autoriser jusqu'au TTL.
      */
      await this.versions.bumpMembership(membershipId);

      await this.audit.record(
        tx,
        context,
        {
          action: 'membership.roles.replaced',
          targetType: 'organization_membership',
          targetId: membershipId,
          previousValues: { roleCodes: previousRoleCodes },
          newValues: { roleCodes: roles.map((role) => role.code) },
        },
        {
          requestId: input.requestId,
          ipAddress: input.ipAddress,
          actorRole: input.actorRole,
        },
      );

      return {
        membershipId,
        previousRoleCodes,
        roleCodes: roles.map((role) => role.code),
      };
    });
  }
}
