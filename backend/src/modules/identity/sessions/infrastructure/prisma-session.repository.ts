import { Injectable } from '@nestjs/common';

import {
  ID_PREFIXES,
  newId,
} from '../../../../infrastructure/database/identifiers';
import type { TransactionalClient } from '../../../../infrastructure/database/transaction.manager';
import {
  SessionRepository,
  type CreatedSession,
  type NewRefreshToken,
  type NewSession,
} from '../domain/session.repository';

@Injectable()
export class PrismaSessionRepository extends SessionRepository {
  async createWithRefreshToken(
    tx: TransactionalClient,
    session: NewSession,
    refreshToken: NewRefreshToken,
  ): Promise<CreatedSession> {
    const sessionId = newId(ID_PREFIXES.session);
    // The family root. Every rotation descends from it, and replay detection
    // revokes the family by this id without walking the chain.
    const tokenFamilyId = newId(ID_PREFIXES.session);
    const refreshTokenId = newId(ID_PREFIXES.session);

    await tx.userSession.create({
      data: {
        id: sessionId,
        userId: session.userId,
        organizationId: session.organizationId,
        activeMembershipId: session.membershipId,
        tokenFamilyId,
        clientType: session.clientType,
        status: 'ACTIVE',
        authenticationLevel: session.authenticationLevel,
        idleExpiresAt: session.idleExpiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
        userAgent: session.userAgent,
        ipAddress: session.ipAddress,
        createdByRequestId: session.requestId,
      },
    });

    await tx.refreshTokenRotation.create({
      data: {
        id: refreshTokenId,
        sessionId,
        tokenFamilyId,
        tokenHash: refreshToken.tokenHash,
        status: 'ACTIVE',
        expiresAt: refreshToken.expiresAt,
      },
    });

    return { sessionId, tokenFamilyId, refreshTokenId };
  }

  async touchLastLogin(
    tx: TransactionalClient,
    userId: string,
    at: Date,
  ): Promise<void> {
    await tx.user.update({ where: { id: userId }, data: { lastLoginAt: at } });
  }

  async replaceSession(
    tx: TransactionalClient,
    input: { sessionId: string; userId: string; now: Date },
  ): Promise<void> {
    // Filtered on `userId` as well as the id: ownership lives in the WHERE
    // clause, not in a check above it that a later edit could drop.
    await tx.userSession.updateMany({
      where: { id: input.sessionId, userId: input.userId, status: 'ACTIVE' },
      data: {
        status: 'REPLACED',
        revokedAt: input.now,
        revokedBy: input.userId,
        revocationReason: 'ORGANIZATION_CONTEXT_SWITCHED',
      },
    });

    await tx.refreshTokenRotation.updateMany({
      where: { sessionId: input.sessionId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: input.now },
    });
  }
}
