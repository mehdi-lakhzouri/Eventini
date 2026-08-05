import { Inject, Injectable } from '@nestjs/common';

import type {
  AuthenticationLevel,
  SessionClientType,
} from '../../../../infrastructure/database/enums';
import { TENANT_SCOPED_PRISMA } from '../../../../infrastructure/database/prisma.tokens';
import type { TenantScopedPrismaClient } from '../../../../infrastructure/database/tenant-scope.extension';
import {
  RevocationRepository,
  type CallerSession,
  type SessionSummary,
} from '../domain/revocation.repository';

@Injectable()
export class PrismaRevocationRepository extends RevocationRepository {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA)
    private readonly prisma: TenantScopedPrismaClient,
  ) {
    super();
  }

  async findCallerSession(sessionId: string): Promise<CallerSession | null> {
    const row = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        organizationId: true,
        activeMembershipId: true,
        clientType: true,
        authenticationLevel: true,
        status: true,
        idleExpiresAt: true,
        absoluteExpiresAt: true,
        user: { select: { version: true, status: true } },
      },
    });

    if (row === null) {
      return null;
    }

    return {
      sessionId: row.id,
      userId: row.userId,
      userVersion: row.user.version,
      userStatus: row.user.status,
      organizationId: row.organizationId,
      membershipId: row.activeMembershipId,
      clientType: row.clientType as SessionClientType,
      authenticationLevel: row.authenticationLevel as AuthenticationLevel,
      status: row.status,
      idleExpiresAt: row.idleExpiresAt,
      absoluteExpiresAt: row.absoluteExpiresAt,
    };
  }

  async listActiveSessions(userId: string): Promise<SessionSummary[]> {
    const rows = await this.prisma.userSession.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        clientType: true,
        deviceName: true,
        createdAt: true,
        lastSeenAt: true,
      },
    });

    return rows.map((row) => ({
      sessionId: row.id,
      clientType: row.clientType,
      deviceName: row.deviceName,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      current: false,
    }));
  }

  async revokeSession(input: {
    sessionId: string;
    userId: string;
    revokedBy: string;
    reason: string;
    now: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Scoped to the caller's own user id: ownership is enforced by the
      // WHERE clause, not by a check that a later edit could drop.
      const revoked = await tx.userSession.updateMany({
        where: {
          id: input.sessionId,
          userId: input.userId,
          status: 'ACTIVE',
        },
        data: {
          status: 'REVOKED',
          revokedAt: input.now,
          revokedBy: input.revokedBy,
          revocationReason: input.reason,
        },
      });

      if (revoked.count === 0) {
        return false;
      }

      // The family goes with the session. Leaving a live refresh token behind
      // would let the holder rebuild the session it belonged to.
      await tx.refreshTokenRotation.updateMany({
        where: { sessionId: input.sessionId, status: { in: ['ACTIVE'] } },
        data: { status: 'REVOKED', revokedAt: input.now },
      });

      return true;
    });
  }

  async revokeAllSessions(input: {
    userId: string;
    revokedBy: string;
    reason: string;
    now: Date;
  }): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const sessions = await tx.userSession.findMany({
        where: { userId: input.userId, status: 'ACTIVE' },
        select: { id: true },
      });
      const ids = sessions.map((session) => session.id);

      await tx.userSession.updateMany({
        where: { id: { in: ids } },
        data: {
          status: 'REVOKED',
          revokedAt: input.now,
          revokedBy: input.revokedBy,
          revocationReason: input.reason,
        },
      });

      await tx.refreshTokenRotation.updateMany({
        where: { sessionId: { in: ids }, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: input.now },
      });

      // In the same transaction as the revocations: a version bump that
      // committed separately would leave a window where the sessions were
      // gone but the tokens still matched, or the reverse.
      await tx.user.update({
        where: { id: input.userId },
        data: { version: { increment: 1 } },
      });

      return ids.length;
    });
  }
}
