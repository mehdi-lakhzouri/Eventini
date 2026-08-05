import { Inject, Injectable } from '@nestjs/common';

import type {
  AuthenticationLevel,
  SessionClientType,
} from '../../../../infrastructure/database/enums';
import {
  ID_PREFIXES,
  newId,
} from '../../../../infrastructure/database/identifiers';
import { TENANT_SCOPED_PRISMA } from '../../../../infrastructure/database/prisma.tokens';
import type { TenantScopedPrismaClient } from '../../../../infrastructure/database/tenant-scope.extension';
import {
  RotationConflictError,
  RotationRepository,
  type RotationOutcome,
  type RotationRecord,
} from '../domain/rotation.repository';

/** Prisma's unique-constraint code. */
const UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}

@Injectable()
export class PrismaRotationRepository extends RotationRepository {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA)
    private readonly prisma: TenantScopedPrismaClient,
  ) {
    super();
  }

  async findByTokenHash(tokenHash: string): Promise<RotationRecord | null> {
    const row = await this.prisma.refreshTokenRotation.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        status: true,
        tokenFamilyId: true,
        expiresAt: true,
        session: {
          select: {
            id: true,
            userId: true,
            user: {
              select: {
                version: true,
                platformRoleAssignments: {
                  where: { status: 'ACTIVE' },
                  select: { id: true },
                },
              },
            },
            organizationId: true,
            activeMembershipId: true,
            clientType: true,
            authenticationLevel: true,
            status: true,
            idleExpiresAt: true,
            absoluteExpiresAt: true,
          },
        },
      },
    });

    if (row === null) {
      return null;
    }

    return {
      rotationId: row.id,
      status: row.status,
      tokenFamilyId: row.tokenFamilyId,
      expiresAt: row.expiresAt,
      session: {
        sessionId: row.session.id,
        userId: row.session.userId,
        userVersion: row.session.user.version,
        hasPlatformRole: row.session.user.platformRoleAssignments.length > 0,
        organizationId: row.session.organizationId,
        membershipId: row.session.activeMembershipId,
        clientType: row.session.clientType as SessionClientType,
        authenticationLevel: row.session
          .authenticationLevel as AuthenticationLevel,
        status: row.session.status,
        idleExpiresAt: row.session.idleExpiresAt,
        absoluteExpiresAt: row.session.absoluteExpiresAt,
      },
    };
  }

  async rotate(input: {
    currentRotationId: string;
    sessionId: string;
    tokenFamilyId: string;
    nextTokenHash: string;
    nextExpiresAt: Date;
    idleExpiresAt: Date;
    now: Date;
  }): Promise<RotationOutcome> {
    const nextId = newId(ID_PREFIXES.session);

    try {
      await this.prisma.$transaction(async (tx) => {
        // Conditional on ACTIVE so a row another rotation already consumed is
        // not silently re-consumed here.
        const consumed = await tx.refreshTokenRotation.updateMany({
          where: { id: input.currentRotationId, status: 'ACTIVE' },
          data: { status: 'CONSUMED', consumedAt: input.now },
        });

        if (consumed.count === 0) {
          throw new RotationConflictError();
        }

        // The insert is what `ux_refresh_active_per_family` arbitrates: two
        // concurrent rotations both reach here and exactly one commits.
        await tx.refreshTokenRotation.create({
          data: {
            id: nextId,
            sessionId: input.sessionId,
            tokenFamilyId: input.tokenFamilyId,
            tokenHash: input.nextTokenHash,
            previousTokenId: input.currentRotationId,
            status: 'ACTIVE',
            expiresAt: input.nextExpiresAt,
          },
        });

        await tx.refreshTokenRotation.update({
          where: { id: input.currentRotationId },
          data: { replacedByTokenId: nextId },
        });

        // `absoluteExpiresAt` is deliberately absent: a rotation moves the
        // idle deadline and never the absolute one.
        await tx.userSession.update({
          where: { id: input.sessionId },
          data: { lastSeenAt: input.now, idleExpiresAt: input.idleExpiresAt },
        });
      });
    } catch (error: unknown) {
      if (error instanceof RotationConflictError || isUniqueViolation(error)) {
        throw new RotationConflictError();
      }

      throw error;
    }

    return { rotationId: nextId };
  }

  async recordReuse(input: {
    rotationId: string;
    sessionId: string;
    tokenFamilyId: string;
    now: Date;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.refreshTokenRotation.update({
        where: { id: input.rotationId },
        data: { status: 'REUSED', reuseDetectedAt: input.now },
      });

      // The whole family, not just the replayed token: we cannot tell which
      // of the two holders is legitimate, so both lose access. The victim
      // signs in again; the attacker cannot.
      await tx.refreshTokenRotation.updateMany({
        where: {
          tokenFamilyId: input.tokenFamilyId,
          status: { in: ['ACTIVE', 'CONSUMED'] },
        },
        data: { status: 'REVOKED', revokedAt: input.now },
      });

      await tx.userSession.update({
        where: { id: input.sessionId },
        data: {
          status: 'COMPROMISED',
          revokedAt: input.now,
          revocationReason: 'REFRESH_TOKEN_REUSE_DETECTED',
        },
      });
    });
  }
}
