import { Inject, Injectable } from '@nestjs/common';

import { TENANT_SCOPED_PRISMA } from '../../../infrastructure/database/prisma.tokens';
import type { TenantScopedPrismaClient } from '../../../infrastructure/database/tenant-scope.extension';
import {
  OrganizationRepository,
  type ActivationRefusal,
  type ActivationTarget,
  type MembershipSummary,
} from '../domain/organization.repository';

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
}
