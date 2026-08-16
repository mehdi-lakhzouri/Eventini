import { isIP } from 'node:net';

import { Inject, Injectable } from '@nestjs/common';

import {
  ID_PREFIXES,
  newId,
} from '../../../../infrastructure/database/identifiers';
import { Prisma } from '../../../../infrastructure/database/prisma/generated/client';
import { TENANT_SCOPED_PRISMA } from '../../../../infrastructure/database/prisma.tokens';
import type { TenantScopedPrismaClient } from '../../../../infrastructure/database/tenant-scope.extension';
import {
  SecurityEventRepository,
  type SecurityEventRecord,
} from '../domain/security-event.repository';

@Injectable()
export class PrismaSecurityEventRepository extends SecurityEventRepository {
  /**
   * Le client scopé, sur sa connexion propre.
   *
   * `security_events` est classée `TENANT_OPTIONAL` dans `tenant-ownership.ts`
   * — la garde ne lui impose pas de filtre `organization_id`, ce qui est
   * exactement ce qu'il faut ici : une bonne partie de ces lignes n'a aucune
   * organisation à porter. Pas besoin de `$unscoped`, donc pas d'entrée dans
   * la liste d'exemptions et pas de `UNSCOPED_QUERY_EXECUTED` parasite à
   * chaque login raté.
   */
  constructor(
    @Inject(TENANT_SCOPED_PRISMA)
    private readonly prisma: TenantScopedPrismaClient,
  ) {
    super();
  }

  async record(event: SecurityEventRecord): Promise<void> {
    await this.prisma.securityEvent.create({
      data: {
        id: newId(ID_PREFIXES.securityEvent),
        eventType: event.eventType,
        severity: event.severity,
        result: event.result,
        reasonCode: event.reasonCode,
        userId: event.userId,
        sessionId: event.sessionId,
        organizationId: event.organizationId,
        membershipId: event.membershipId,
        deviceId: event.deviceId,
        requestId: event.requestId,
        traceId: event.traceId,
        ipAddress: toInet(event.ipAddress),
        userAgent: event.userAgent,
        metadata: toJsonInput(event.metadata),
        occurredAt: event.occurredAt,
      },
    });
  }
}

/**
 * Vers ce que la colonne `INET` accepte, ou `null`.
 *
 * ## 🔴 Le cas que ça ferme
 *
 * `ip_address` est de type `INET` et sa valeur vient d'`request.ip`, donc
 * potentiellement d'un en-tête `X-Forwarded-For` — c'est-à-dire d'une chaîne
 * que l'appelant contrôle. PostgreSQL refuse une valeur `INET` malformée, et
 * comme le recorder ne relance jamais, l'insertion échouerait **en silence**.
 *
 * Le résultat serait une jolie primitive de suppression : envoyer un
 * `X-Forwarded-For` invalide suffirait à ne laisser aucune trace de ses
 * tentatives. On préfère perdre l'adresse que perdre l'événement.
 */
function toInet(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const candidate = value.trim();

  return isIP(candidate) === 0 ? null : candidate;
}

/**
 * `metadata` est `NOT NULL DEFAULT '{}'` : un objet vide est la valeur normale,
 * jamais SQL NULL. Contrairement aux diffs d'audit, il n'y a donc pas de
 * `Prisma.DbNull` à distinguer ici.
 *
 * Le passage par `JSON.parse(JSON.stringify(...))` normalise ce que la colonne
 * ne sait pas stocker — `Date`, `undefined`, `Map` — pour que ce qui est relu
 * soit ce qui a été écrit. Même motif que `prisma-audit-log.repository.ts`.
 */
function toJsonInput(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
