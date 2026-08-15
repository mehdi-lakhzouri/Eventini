import { Inject, Injectable } from '@nestjs/common';

import { TENANT_SCOPED_PRISMA } from '../../../infrastructure/database/prisma.tokens';
import type { TenantScopedPrismaClient } from '../../../infrastructure/database/tenant-scope.extension';
import type { TenantContext } from '../../../common/types/tenant-context';
import {
  OrganizationRepository,
  type ActivationRefusal,
  type ActivationTarget,
  type MembershipSummary,
  type OrganizationChanges,
  type OrganizationProfile,
  type OrganizationWriteFailure,
} from '../domain/organization.repository';

/** Les colonnes rendues au client, nommées une fois. */
const PROFILE_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  licensePlan: true,
  userLimit: true,
  eventLimit: true,
  isEnabled: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;

type ProfileRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  licensePlan: string;
  userLimit: number | null;
  eventLimit: number | null;
  isEnabled: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

const toProfile = (row: ProfileRow): OrganizationProfile => ({
  organizationId: row.id,
  name: row.name,
  slug: row.slug,
  status: row.status,
  licensePlan: row.licensePlan,
  userLimit: row.userLimit,
  eventLimit: row.eventLimit,
  isEnabled: row.isEnabled,
  version: row.version,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** Le code PostgreSQL d'une violation de contrainte d'unicité. */
const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class PrismaOrganizationRepository extends OrganizationRepository {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA)
    private readonly prisma: TenantScopedPrismaClient,
  ) {
    super();
  }

  /**
   * Unscoped, and it has to be: "which organizations do I belong to" spans
   * organizations by definition, so there is no `organization_id` to filter on
   * — the answer is the set of them. The tenant guard is right to stop the
   * query, and ADR-0003 provides this callback as the explicit, logged
   * exemption rather than a flag that could outlive the operation.
   *
   * What keeps it safe is the `userId` filter: the result is derived from the
   * caller's own memberships, so it cannot be made to include an organization
   * they have no membership in. Nothing here reads a client-supplied
   * organization id.
   */
  async listForUser(
    userId: string,
    currentOrganizationId: string | null,
  ): Promise<MembershipSummary[]> {
    const memberships = await this.prisma.$unscoped(
      'List the caller own organization memberships (EVT-033)',
      () =>
        this.prisma.organizationMembership.findMany({
          where: { userId, status: 'ACTIVE', deletedAt: null },
          select: {
            id: true,
            organizationId: true,
            organization: {
              select: { name: true, slug: true, status: true, isEnabled: true },
            },
          },
        }),
    );

    return (
      memberships
        // A membership in a suspended organization is not somewhere the caller
        // can switch to, so listing it would only offer a door that 403s.
        .filter(
          (membership) =>
            membership.organization.status === 'ACTIVE' &&
            membership.organization.isEnabled,
        )
        .map((membership) => ({
          organizationId: membership.organizationId,
          membershipId: membership.id,
          name: membership.organization.name,
          slug: membership.organization.slug,
          active: membership.organizationId === currentOrganizationId,
        }))
    );
  }

  async findActivationTarget(
    userId: string,
    organizationId: string,
  ): Promise<ActivationTarget | ActivationRefusal> {
    /**
     * Unscoped for the same structural reason: the whole point of an
     * activation is that the session is *not yet* scoped to the target, so
     * there is no context to filter on — filtering on the current organization
     * would make switching away from it impossible.
     *
     * Both halves of the WHERE carry the safety. `userId` is what makes a
     * forged organization id find nothing rather than scope a query onto
     * someone else's tenant, and `organizationId` is used only to *match* a
     * membership row that already belongs to this caller.
     */
    const membership = await this.prisma.$unscoped(
      'Resolve an organization activation target (EVT-033)',
      () =>
        this.prisma.organizationMembership.findFirst({
          where: { userId, organizationId, status: 'ACTIVE', deletedAt: null },
          select: {
            id: true,
            organization: { select: { status: true, isEnabled: true } },
          },
        }),
    );

    if (membership === null) {
      return 'NO_MEMBERSHIP';
    }

    if (
      membership.organization.status !== 'ACTIVE' ||
      !membership.organization.isEnabled
    ) {
      return 'ORGANIZATION_UNAVAILABLE';
    }

    return { organizationId, membershipId: membership.id };
  }

  /**
   * L'organisation de la session, lue avec son `organization_id` en filtre.
   *
   * Le filtre est présent **malgré** la clé primaire. C'est la règle de la
   * garde Prisma, sans exception pour les lectures par identifiant : une
   * lecture qui ne porte que sur `id` est une lecture qu'un identifiant forgé
   * suffirait à détourner le jour où l'identifiant vient d'ailleurs que de la
   * session.
   */
  async findProfile(
    context: TenantContext,
  ): Promise<OrganizationProfile | null> {
    const row = await this.prisma.organization.findFirst({
      where: { id: context.organizationId, deletedAt: null },
      select: PROFILE_SELECT,
    });

    return row === null ? null : toProfile(row);
  }

  /**
   * Écriture versionnée — EVT-032.
   *
   * `version` est dans le `WHERE`, pas dans une vérification préalable. Lire
   * puis écrire laisse entre les deux une fenêtre où un autre administrateur
   * peut commettre son changement ; c'est précisément la perte de mise à jour
   * que ce mécanisme existe pour empêcher. Zéro ligne affectée signifie donc
   * « quelqu'un est passé avant vous », et non « la ressource est absente ».
   *
   * D'où la relecture qui suit : elle seule distingue une organisation
   * supprimée d'une organisation modifiée entre-temps, et le client a besoin
   * des deux réponses — l'une est définitive, l'autre invite à recommencer.
   */
  async updateProfile(
    context: TenantContext,
    expectedVersion: number,
    changes: OrganizationChanges,
    actorId: string,
  ): Promise<OrganizationProfile | OrganizationWriteFailure> {
    try {
      const affected = await this.prisma.organization.updateMany({
        where: {
          id: context.organizationId,
          version: expectedVersion,
          deletedAt: null,
        },
        data: {
          ...changes,
          version: { increment: 1 },
          updatedBy: actorId,
        },
      });

      if (affected.count === 0) {
        const current = await this.findProfile(context);

        return current === null ? 'NOT_FOUND' : 'CONFLICT';
      }
    } catch (error: unknown) {
      /*
        L'index `ux_organizations_slug_active` est partiel sur `deleted_at` et
        global aux organisations vivantes : le slug demandé peut appartenir à
        une organisation que l'appelant n'a pas le droit de voir. Le refus ne
        le nomme donc pas — répondre « pris par Congrès Alpha » ferait de cette
        route un moyen d'énumérer les organisations de la plateforme.
      */
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: unknown }).code === UNIQUE_VIOLATION
      ) {
        return 'SLUG_TAKEN';
      }

      throw error;
    }

    const updated = await this.findProfile(context);

    // La relecture suit immédiatement une écriture réussie dans la même
    // requête : `null` ici voudrait dire que la ligne a disparu entre les
    // deux, ce que seule une suppression concurrente produit.
    return updated ?? 'NOT_FOUND';
  }
}
