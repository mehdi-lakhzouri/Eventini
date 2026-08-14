import { Inject, Injectable } from '@nestjs/common';

import {
  ID_PREFIXES,
  newId,
} from '../../../../infrastructure/database/identifiers';
import { TENANT_SCOPED_PRISMA } from '../../../../infrastructure/database/prisma.tokens';
import type { TenantScopedPrismaClient } from '../../../../infrastructure/database/tenant-scope.extension';
import type { TransactionalClient } from '../../../../infrastructure/database/transaction.manager';
import {
  MfaRepository,
  type MfaMethodRecord,
  type RecoveryCodeRecord,
} from '../domain/mfa.repository';

@Injectable()
export class PrismaMfaRepository extends MfaRepository {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA)
    private readonly prisma: TenantScopedPrismaClient,
  ) {
    super();
  }

  async findAccountName(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { primaryEmail: true },
    });

    return user?.primaryEmail ?? null;
  }

  async findActiveMethod(userId: string): Promise<MfaMethodRecord | null> {
    return this.findByStatus(userId, 'ACTIVE');
  }

  async findPendingMethod(userId: string): Promise<MfaMethodRecord | null> {
    return this.findByStatus(userId, 'PENDING');
  }

  async startEnrollment(input: {
    userId: string;
    encryptedSecret: string;
    now: Date;
  }): Promise<string> {
    const methodId = newId(ID_PREFIXES.user);

    await this.prisma.$transaction(async (tx) => {
      // A previous PENDING enrolment is abandoned, not kept: the partial
      // unique index allows exactly one, and the newest QR code is the one
      // the user is looking at.
      await tx.mfaMethod.updateMany({
        where: { userId: input.userId, type: 'TOTP', status: 'PENDING' },
        data: { status: 'DISABLED', disabledAt: input.now },
      });

      await tx.mfaMethod.create({
        data: {
          id: methodId,
          userId: input.userId,
          type: 'TOTP',
          status: 'PENDING',
          encryptedSecret: input.encryptedSecret,
        },
      });
    });

    return methodId;
  }

  async activate(input: {
    userId: string;
    methodId: string;
    codeHashes: readonly string[];
    now: Date;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // The old ACTIVE method goes first, or `ux_mfa_user_type_active` would
      // refuse the promotion — the index is what makes a swap atomic rather
      // than a window with two live methods.
      await tx.mfaMethod.updateMany({
        where: {
          userId: input.userId,
          type: 'TOTP',
          status: 'ACTIVE',
          id: { not: input.methodId },
        },
        data: { status: 'DISABLED', disabledAt: input.now },
      });

      await tx.mfaMethod.update({
        where: { id: input.methodId },
        data: {
          status: 'ACTIVE',
          verifiedAt: input.now,
          enabledAt: input.now,
        },
      });

      await writeRecoveryCodes(tx, input.methodId, input.codeHashes, input.now);
    });
  }

  async listAvailableRecoveryCodes(
    methodId: string,
  ): Promise<RecoveryCodeRecord[]> {
    const rows = await this.prisma.mfaRecoveryCode.findMany({
      where: { mfaMethodId: methodId, usedAt: null, revokedAt: null },
      select: { id: true, codeHash: true },
    });

    return rows.map((row) => ({ codeId: row.id, codeHash: row.codeHash }));
  }

  async consumeRecoveryCode(input: {
    codeId: string;
    now: Date;
  }): Promise<boolean> {
    // Conditional, so the same printed code cannot be spent twice by two
    // requests arriving together.
    const consumed = await this.prisma.mfaRecoveryCode.updateMany({
      where: { id: input.codeId, usedAt: null, revokedAt: null },
      data: { usedAt: input.now },
    });

    return consumed.count === 1;
  }

  async replaceRecoveryCodes(input: {
    methodId: string;
    codeHashes: readonly string[];
    now: Date;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.mfaRecoveryCode.updateMany({
        where: { mfaMethodId: input.methodId, usedAt: null, revokedAt: null },
        data: { revokedAt: input.now },
      });

      await writeRecoveryCodes(tx, input.methodId, input.codeHashes, input.now);
    });
  }

  async disable(input: {
    userId: string;
    methodId: string;
    now: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const disabled = await tx.mfaMethod.updateMany({
        where: {
          id: input.methodId,
          userId: input.userId,
          status: { in: ['ACTIVE', 'PENDING'] },
        },
        data: { status: 'DISABLED', disabledAt: input.now },
      });

      if (disabled.count === 0) {
        return false;
      }

      // Codes for a disabled method are dead weight and a live credential if
      // the method is ever re-enabled by hand.
      await tx.mfaRecoveryCode.updateMany({
        where: { mfaMethodId: input.methodId, usedAt: null, revokedAt: null },
        data: { revokedAt: input.now },
      });

      return true;
    });
  }

  private async findByStatus(
    userId: string,
    status: string,
  ): Promise<MfaMethodRecord | null> {
    const method = await this.prisma.mfaMethod.findFirst({
      where: { userId, type: 'TOTP', status },
      select: { id: true, encryptedSecret: true },
    });

    return method === null
      ? null
      : { methodId: method.id, encryptedSecret: method.encryptedSecret };
  }
}

async function writeRecoveryCodes(
  tx: TransactionalClient,
  methodId: string,
  codeHashes: readonly string[],
  now: Date,
): Promise<void> {
  await tx.mfaRecoveryCode.createMany({
    data: codeHashes.map((codeHash) => ({
      id: newId(ID_PREFIXES.user),
      mfaMethodId: methodId,
      codeHash,
      createdAt: now,
    })),
  });
}
