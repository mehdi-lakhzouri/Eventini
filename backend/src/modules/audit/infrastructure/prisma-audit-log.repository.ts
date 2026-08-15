import { Injectable } from '@nestjs/common';

import { buildAuditDiff } from '../../../infrastructure/audit';
import { Prisma } from '../../../infrastructure/database/prisma/generated/client';
import {
  ID_PREFIXES,
  newId,
} from '../../../infrastructure/database/identifiers';
import type { TransactionalClient } from '../../../infrastructure/database/transaction.manager';
import {
  AuditLogRepository,
  type AuditEntry,
} from '../domain/audit-log.repository';

@Injectable()
export class PrismaAuditLogRepository extends AuditLogRepository {
  /**
   * Écrit l'entrée **sur le client transactionnel fourni**, jamais sur le sien.
   *
   * Ce repository n'injecte donc aucun client Prisma : il n'en a pas besoin, et
   * en avoir un ouvrirait la porte à une écriture hors de la transaction de
   * l'appelant — précisément ce que ce port existe pour empêcher.
   *
   * `audit_logs` n'a pas de colonne `organization_id` obligatoire et la table
   * est écrite depuis des contextes plateforme comme tenant ; le filtre de la
   * garde ne s'applique pas à une insertion, qui ne lit rien.
   */
  async record(tx: TransactionalClient, entry: AuditEntry): Promise<void> {
    const { previousValues, newValues } = buildAuditDiff(
      entry.previousValues,
      entry.newValues,
    );

    await tx.auditLog.create({
      data: {
        id: newId(ID_PREFIXES.auditLog),
        actorUserId: entry.actorUserId,
        actorSessionId: entry.actorSessionId,
        actorRole: entry.actorRole,
        organizationId: entry.organizationId,
        targetType: entry.targetType,
        targetId: entry.targetId,
        action: entry.action,
        previousValues: toJsonInput(previousValues),
        newValues: toJsonInput(newValues),
        reason: entry.reason ?? null,
        requestId: entry.requestId,
        ipAddress: entry.ipAddress,
      },
    });
  }
}

/**
 * Vers ce qu'accepte une colonne `Json`.
 *
 * `Prisma.DbNull` et non `null` : sur une colonne JSON nullable, un `null`
 * JavaScript signifie le **littéral JSON `null`**, pas SQL NULL. Les deux se
 * relisent différemment, et une entrée d'audit qui contient `"null"` là où on
 * attendait une absence est une entrée qu'un lecteur interprétera de travers.
 *
 * Le passage par `JSON.parse(JSON.stringify(...))` normalise en même temps ce
 * que la colonne ne sait pas stocker — `Date`, `undefined`, `Map`. Le faire
 * ici plutôt que de laisser le driver coercer garantit que ce qui est relu est
 * ce qui a été écrit. Même motif que `prisma-idempotency.repository.ts`.
 */
function toJsonInput(
  value: Record<string, unknown> | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null
    ? Prisma.DbNull
    : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);
}
