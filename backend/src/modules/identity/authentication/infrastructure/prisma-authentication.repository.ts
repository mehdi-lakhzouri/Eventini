import { Inject, Injectable } from '@nestjs/common';

import { TENANT_SCOPED_PRISMA } from '../../../../infrastructure/database/prisma.tokens';
import type { TenantScopedPrismaClient } from '../../../../infrastructure/database/tenant-scope.extension';
import {
  AuthenticationRepository,
  type AuthenticationCandidate,
} from '../domain/authentication.repository';

@Injectable()
export class PrismaAuthenticationRepository extends AuthenticationRepository {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA)
    private readonly prisma: TenantScopedPrismaClient,
  ) {
    super();
  }

  async findCandidateByEmail(
    normalizedEmail: string,
  ): Promise<AuthenticationCandidate | null> {
    const user = await this.prisma.user.findFirst({
      // Soft-deleted accounts do not authenticate; the partial unique index
      // excludes them, so the address may even belong to someone else now.
      where: { normalizedEmail, deletedAt: null },
      select: {
        id: true,
        status: true,
        version: true,
        credential: { select: { passwordHash: true, passwordVersion: true } },
        mfaMethods: { where: { status: 'ACTIVE' }, select: { id: true } },
        platformRoleAssignments: {
          where: { status: 'ACTIVE' },
          select: { id: true },
        },
        memberships: {
          where: { status: 'ACTIVE', deletedAt: null },
          select: {
            id: true,
            organizationId: true,
            organization: { select: { status: true, isEnabled: true } },
          },
        },
      },
    });

    if (user === null) {
      return null;
    }

    return {
      userId: user.id,
      status: user.status,
      userVersion: user.version,
      passwordHash: user.credential?.passwordHash ?? null,
      passwordVersion: user.credential?.passwordVersion ?? 0,
      hasActiveMfa: user.mfaMethods.length > 0,
      hasPlatformRole: user.platformRoleAssignments.length > 0,
      memberships: user.memberships.map((membership) => ({
        membershipId: membership.id,
        organizationId: membership.organizationId,
        organizationActive: membership.organization.status === 'ACTIVE',
        organizationEnabled: membership.organization.isEnabled,
      })),
    };
  }
}
