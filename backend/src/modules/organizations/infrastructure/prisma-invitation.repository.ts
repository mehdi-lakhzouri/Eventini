import { Inject, Injectable } from '@nestjs/common';

import {
  ID_PREFIXES,
  newId,
} from '../../../infrastructure/database/identifiers';
import { TENANT_SCOPED_PRISMA } from '../../../infrastructure/database/prisma.tokens';
import type { TenantScopedPrismaClient } from '../../../infrastructure/database/tenant-scope.extension';
import type { TenantContext } from '../../../common/types/tenant-context';
import {
  InvitationRepository,
  type AcceptedInvitation,
  type AssignableRole,
  type CreateInvitationCommand,
  type InvitationRefusal,
  type InvitationSummary,
  type PendingInvitation,
} from '../domain/invitation.repository';

type InvitationRow = {
  id: string;
  email: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  acceptedAt: Date | null;
  role: { code: string };
};

const toSummary = (row: InvitationRow): InvitationSummary => ({
  invitationId: row.id,
  email: row.email,
  status: row.status,
  roleCode: row.role.code,
  expiresAt: row.expiresAt,
  createdAt: row.createdAt,
  acceptedAt: row.acceptedAt,
});

const SUMMARY_SELECT = {
  id: true,
  email: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  acceptedAt: true,
  role: { select: { code: true } },
} as const;

@Injectable()
export class PrismaInvitationRepository extends InvitationRepository {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA)
    private readonly prisma: TenantScopedPrismaClient,
  ) {
    super();
  }

  /**
   * Le rôle nommé, uniquement s'il est de portée `ORGANIZATION`.
   *
   * La portée est dans le `WHERE`, pas vérifiée après lecture : un filtre
   * appliqué en aval est un filtre qu'un `return` anticipé peut sauter, et
   * celui-ci est la barrière contre l'assignation d'un rôle plateforme depuis
   * l'API d'organisation.
   *
   * `roles` est une table de référence globale, sans `organization_id` : la
   * lecture est donc légitimement hors contexte tenant.
   */
  async findAssignableRole(code: string): Promise<AssignableRole | null> {
    const row = await this.prisma.$unscoped(
      'Read the global role catalogue, which has no organization_id (EVT-043)',
      () =>
        this.prisma.role.findFirst({
          where: { code, scope: 'ORGANIZATION' },
          select: { id: true, code: true },
        }),
    );

    return row === null ? null : { roleId: row.id, code: row.code };
  }

  /**
   * Remplacement des `PENDING` puis création, dans une transaction.
   *
   * L'ordre compte : remplacer d'abord garantit qu'à aucun instant deux
   * invitations `PENDING` ne coexistent pour la même adresse. Créer d'abord
   * ouvrirait une fenêtre — courte, mais suffisante pour qu'une acceptation
   * concurrente trouve deux lignes valides, dont une portant le rôle que
   * l'invitant croyait justement avoir remplacé.
   */
  async create(
    context: TenantContext,
    command: CreateInvitationCommand,
  ): Promise<InvitationSummary> {
    return this.prisma.$transaction(async (tx) => {
      await tx.userInvitation.updateMany({
        where: {
          organizationId: context.organizationId,
          normalizedEmail: command.normalizedEmail,
          status: 'PENDING',
        },
        data: { status: 'REPLACED' },
      });

      const row = await tx.userInvitation.create({
        data: {
          id: newId(ID_PREFIXES.invitation),
          organizationId: context.organizationId,
          email: command.email,
          normalizedEmail: command.normalizedEmail,
          roleId: command.roleId,
          tokenHash: command.tokenHash,
          status: 'PENDING',
          expiresAt: command.expiresAt,
          createdBy: command.invitedBy,
        },
        select: SUMMARY_SELECT,
      });

      return toSummary(row);
    });
  }

  async listForOrganization(
    context: TenantContext,
  ): Promise<InvitationSummary[]> {
    const rows = await this.prisma.userInvitation.findMany({
      where: { organizationId: context.organizationId },
      select: SUMMARY_SELECT,
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(toSummary);
  }

  async revoke(
    context: TenantContext,
    invitationId: string,
    actorId: string,
  ): Promise<boolean> {
    /*
      `organization_id` est dans le `WHERE` en plus de la clé primaire, et
      `status = 'PENDING'` avec : révoquer une invitation déjà acceptée
      effacerait la trace de son acceptation sans annuler le membership qu'elle
      a créé, ce qui laisserait un accès dont plus rien n'explique l'origine.
    */
    const affected = await this.prisma.userInvitation.updateMany({
      where: {
        id: invitationId,
        organizationId: context.organizationId,
        status: 'PENDING',
      },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedBy: actorId },
    });

    return affected.count > 0;
  }

  /**
   * Recherche par empreinte, hors de toute organisation.
   *
   * L'acceptation précède la session : il n'existe aucun contexte tenant à
   * filtrer dessus, et la garde Prisma a raison d'arrêter la requête. Ce qui
   * la rend sûre est que l'empreinte est le **seul** critère — l'appelant ne
   * choisit pas l'organisation qu'il interroge, il présente un secret qui en
   * désigne une.
   */
  async findByTokenHash(tokenHash: string): Promise<PendingInvitation | null> {
    const row = await this.prisma.$unscoped(
      'Resolve an invitation by token hash before any session exists (EVT-043)',
      () =>
        this.prisma.userInvitation.findUnique({
          where: { tokenHash },
          select: {
            id: true,
            organizationId: true,
            email: true,
            normalizedEmail: true,
            roleId: true,
            status: true,
            expiresAt: true,
          },
        }),
    );

    if (row === null || row.status !== 'PENDING') {
      return null;
    }

    const existing = await this.prisma.$unscoped(
      'Find the account behind an invited address before any session exists (EVT-043)',
      () =>
        this.prisma.user.findFirst({
          where: { normalizedEmail: row.normalizedEmail, deletedAt: null },
          select: { id: true },
        }),
    );

    return {
      invitationId: row.id,
      organizationId: row.organizationId,
      email: row.email,
      normalizedEmail: row.normalizedEmail,
      roleId: row.roleId,
      expiresAt: row.expiresAt,
      existingUserId: existing?.id ?? null,
    };
  }

  /**
   * 🔴 Toute l'acceptation dans **une seule** transaction.
   *
   * Utilisateur créé ou retrouvé, membership `ACTIVE`, rôle assigné,
   * invitation `ACCEPTED`. Un échec partiel laisserait l'un des deux états
   * incohérents que rien en aval ne rattrape : un membership sans rôle donne
   * un accès sans droits, et un utilisateur créé sans membership est un compte
   * orphelin qui ne peut ni servir ni être réinvité, puisque son adresse est
   * désormais prise.
   *
   * Le statut de l'invitation est repassé en `PENDING` dans le `WHERE` de sa
   * mise à jour finale : deux acceptations concurrentes du même jeton
   * n'aboutissent donc qu'une fois, et c'est la base qui l'arbitre.
   */
  async accept(input: {
    invitation: PendingInvitation;
    passwordHash: string | null;
  }): Promise<AcceptedInvitation | InvitationRefusal> {
    const { invitation, passwordHash } = input;

    if (invitation.expiresAt.getTime() <= Date.now()) {
      return 'EXPIRED';
    }

    if (invitation.existingUserId === null && passwordHash === null) {
      return 'PASSWORD_REQUIRED';
    }

    return this.prisma
      .$unscoped(
        'Accept an invitation, creating the membership that will scope future requests (EVT-043)',
        () =>
          this.prisma.$transaction(
            async (tx): Promise<AcceptedInvitation | InvitationRefusal> => {
              const userId =
                invitation.existingUserId ?? newId(ID_PREFIXES.user);

              if (invitation.existingUserId === null) {
                await tx.user.create({
                  data: {
                    id: userId,
                    primaryEmail: invitation.email,
                    normalizedEmail: invitation.normalizedEmail,
                    firstName: '',
                    lastName: '',
                    status: 'ACTIVE',
                    /*
                    Vérifiée par construction : le jeton n'a pu être obtenu
                    qu'à cette adresse. Exiger une seconde vérification
                    demanderait à l'utilisateur de prouver deux fois la même
                    chose.
                  */
                    emailVerifiedAt: new Date(),
                  },
                });

                await tx.userCredential.create({
                  data: {
                    /*
                    `ID_PREFIXES.user` sur une ligne de credential : c'est la
                    convention déjà suivie par le module mots de passe, et la
                    relation est 1:1 avec l'utilisateur. Deux conventions
                    concurrentes pour la même table seraient pires qu'une
                    convention discutable et uniforme.
                  */
                    id: newId(ID_PREFIXES.user),
                    userId,
                    passwordHash: passwordHash as string,
                  },
                });
              }

              // `ux_membership_user_org_active` est partiel sur `deleted_at` :
              // un membership révoqué puis soft-deleted laisse la voie libre à
              // une réinvitation, ce qui est le comportement voulu.
              const alreadyMember = await tx.organizationMembership.findFirst({
                where: {
                  userId,
                  organizationId: invitation.organizationId,
                  deletedAt: null,
                },
                select: { id: true },
              });

              if (alreadyMember !== null) {
                return 'ALREADY_MEMBER';
              }

              const membershipId = newId(ID_PREFIXES.membership);

              await tx.organizationMembership.create({
                data: {
                  id: membershipId,
                  userId,
                  organizationId: invitation.organizationId,
                  status: 'ACTIVE',
                },
              });

              await tx.membershipRoleAssignment.create({
                data: {
                  id: newId(ID_PREFIXES.assignment),
                  membershipId,
                  organizationId: invitation.organizationId,
                  roleId: invitation.roleId,
                },
              });

              const consumed = await tx.userInvitation.updateMany({
                // `status: 'PENDING'` ici est ce qui rend deux acceptations
                // concurrentes du même jeton impossibles : la seconde affecte
                // zéro ligne, et c'est PostgreSQL qui arbitre, pas le code.
                where: { id: invitation.invitationId, status: 'PENDING' },
                data: {
                  status: 'ACCEPTED',
                  acceptedAt: new Date(),
                  invitedUserId: userId,
                  membershipId,
                },
              });

              if (consumed.count === 0) {
                // Une autre acceptation est passée entre la lecture et ici. Le
                // `throw` annule la transaction — le membership et le rôle qui
                // viennent d'être écrits disparaissent avec elle.
                throw new InvitationRaceError();
              }

              return {
                userId,
                organizationId: invitation.organizationId,
                membershipId,
              };
            },
          ),
      )
      .catch((error: unknown) => {
        if (error instanceof InvitationRaceError) {
          return 'ALREADY_USED' as const;
        }

        throw error;
      });
  }
}

/** Signale une acceptation concurrente, pour annuler la transaction. */
class InvitationRaceError extends Error {
  constructor() {
    super('Invitation was consumed concurrently');
    this.name = 'InvitationRaceError';
  }
}
