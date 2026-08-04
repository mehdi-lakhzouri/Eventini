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
}
