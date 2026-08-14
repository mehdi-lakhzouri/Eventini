import { Inject, Injectable } from '@nestjs/common';

import { TENANT_SCOPED_PRISMA } from '../../../../infrastructure/database/prisma.tokens';
import type { TenantScopedPrismaClient } from '../../../../infrastructure/database/tenant-scope.extension';
import {
  AuthenticationRepository,
  type AuthenticationCandidate,
  type CurrentUserProfile,
} from '../domain/authentication.repository';

/**
 * Shared so the two lookups cannot drift apart. They answer the same question
 * about the same account — one keyed by address at password time, one keyed by
 * id when a challenge is answered — and a field present in only one of them
 * would mean the MFA path decided on different evidence.
 */
const CANDIDATE_SELECT = {
  id: true,
  status: true,
  version: true,
  credential: { select: { passwordHash: true, passwordVersion: true } },
  mfaMethods: { where: { status: 'ACTIVE' }, select: { id: true } },
  platformRoleAssignments: {
    where: { status: 'ACTIVE' },
    select: { role: { select: { code: true } } },
  },
  memberships: {
    where: { status: 'ACTIVE', deletedAt: null },
    select: {
      id: true,
      organizationId: true,
      organization: { select: { status: true, isEnabled: true } },
    },
  },
} as const;

type CandidateRow = {
  id: string;
  status: string;
  version: number;
  credential: { passwordHash: string; passwordVersion: number } | null;
  mfaMethods: readonly unknown[];
  platformRoleAssignments: readonly { role: { code: string } }[];
  memberships: readonly {
    id: string;
    organizationId: string;
    organization: { status: string; isEnabled: boolean };
  }[];
};

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
      select: CANDIDATE_SELECT,
    });

    return user === null ? null : toCandidate(user);
  }

  async findCandidateById(
    userId: string,
  ): Promise<AuthenticationCandidate | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: CANDIDATE_SELECT,
    });

    return user === null ? null : toCandidate(user);
  }

  async findProfileById(userId: string): Promise<CurrentUserProfile | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        primaryEmail: true,
        firstName: true,
        lastName: true,
        displayName: true,
        status: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        mfaMethods: { where: { status: 'ACTIVE' }, select: { id: true } },
      },
    });

    if (user === null) {
      return null;
    }

    return {
      userId: user.id,
      email: user.primaryEmail,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      lastLoginAt: user.lastLoginAt,
      hasActiveMfa: user.mfaMethods.length > 0,
    };
  }
}

function toCandidate(user: CandidateRow): AuthenticationCandidate {
  const platformRoles = user.platformRoleAssignments.map(
    (assignment) => assignment.role.code,
  );

  return {
    userId: user.id,
    status: user.status,
    userVersion: user.version,
    passwordHash: user.credential?.passwordHash ?? null,
    passwordVersion: user.credential?.passwordVersion ?? 0,
    hasActiveMfa: user.mfaMethods.length > 0,
    hasPlatformRole: platformRoles.length > 0,
    isSuperAdmin: platformRoles.includes('SUPER_ADMIN'),
    memberships: user.memberships.map((membership) => ({
      membershipId: membership.id,
      organizationId: membership.organizationId,
      organizationActive: membership.organization.status === 'ACTIVE',
      organizationEnabled: membership.organization.isEnabled,
    })),
  };
}
