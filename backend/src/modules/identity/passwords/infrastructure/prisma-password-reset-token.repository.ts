import { Inject, Injectable } from '@nestjs/common';

import {
  ID_PREFIXES,
  newId,
} from '../../../../infrastructure/database/identifiers';
import { TENANT_SCOPED_PRISMA } from '../../../../infrastructure/database/prisma.tokens';
import type { TransactionalClient } from '../../../../infrastructure/database/transaction.manager';
import type { TenantScopedPrismaClient } from '../../../../infrastructure/database/tenant-scope.extension';
import {
  PasswordResetTokenRepository,
  type CredentialOwner,
  type PendingResetToken,
} from '../domain/password-reset-token.repository';

@Injectable()
export class PrismaPasswordResetTokenRepository extends PasswordResetTokenRepository {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA)
    private readonly prisma: TenantScopedPrismaClient,
  ) {
    super();
  }

  async findActiveUserByEmail(
    normalizedEmail: string,
  ): Promise<{ userId: string } | null> {
    const user = await this.prisma.user.findFirst({
      where: { normalizedEmail, deletedAt: null, status: 'ACTIVE' },
      select: { id: true },
    });

    return user === null ? null : { userId: user.id };
  }

  async findCredential(userId: string): Promise<CredentialOwner | null> {
    const credential = await this.prisma.userCredential.findUnique({
      where: { userId },
      select: { passwordHash: true },
    });

    return credential === null
      ? null
      : { userId, passwordHash: credential.passwordHash };
  }

  async replacePending(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    requestedIp: string | null;
    now: Date;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: input.userId, status: 'PENDING' },
        data: { status: 'REPLACED', revokedAt: input.now },
      });

      await tx.passwordResetToken.create({
        data: {
          id: newId(ID_PREFIXES.user),
          userId: input.userId,
          tokenHash: input.tokenHash,
          status: 'PENDING',
          expiresAt: input.expiresAt,
          requestedIp: input.requestedIp,
        },
      });
    });
  }

  async findPendingByHash(
    tokenHash: string,
  ): Promise<PendingResetToken | null> {
    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, status: true, expiresAt: true },
    });

    if (row === null || row.status !== 'PENDING') {
      return null;
    }

    return {
      tokenId: row.id,
      userId: row.userId,
      expiresAt: row.expiresAt,
    };
  }

  async consumeAndSetPassword(input: {
    tokenId: string;
    userId: string;
    passwordHash: string;
    passwordVersion: number;
    now: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Conditional on PENDING, so two clicks on the same emailed link cannot
      // both set a password.
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: input.tokenId, status: 'PENDING' },
        data: { status: 'USED', usedAt: input.now },
      });

      if (consumed.count === 0) {
        return false;
      }

      await writeCredential(tx, input);

      return true;
    });
  }

  async setPassword(input: {
    userId: string;
    passwordHash: string;
    passwordVersion: number;
    now: Date;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await writeCredential(tx, input);
    });
  }
}

async function writeCredential(
  tx: TransactionalClient,
  input: {
    userId: string;
    passwordHash: string;
    passwordVersion: number;
    now: Date;
  },
): Promise<void> {
  // Upsert, not update: an account created by the bootstrap procedure has no
  // credential row at all until its first password is set.
  await tx.userCredential.upsert({
    where: { userId: input.userId },
    create: {
      id: newId(ID_PREFIXES.user),
      userId: input.userId,
      passwordHash: input.passwordHash,
      passwordVersion: input.passwordVersion,
      passwordChangedAt: input.now,
    },
    update: {
      passwordHash: input.passwordHash,
      passwordVersion: input.passwordVersion,
      passwordChangedAt: input.now,
      mustChangePassword: false,
    },
  });
}
