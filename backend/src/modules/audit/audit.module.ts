import { Module } from '@nestjs/common';

import { AuditRecorder } from './application/audit-recorder.service';
import { AuditLogRepository } from './domain/audit-log.repository';
import { PrismaAuditLogRepository } from './infrastructure/prisma-audit-log.repository';

/**
 * Le journal d'audit métier — EVT-076.
 *
 * Sorti d'EVT-044 dans sa propre livraison parce qu'il sert quatre tickets :
 * EVT-042 (renommage d'organisation), EVT-043 (invitations), EVT-044
 * (assignation de rôles) et EVT-045 (cycle de vie des memberships). Le relire
 * isolément est plus simple que noyé dans l'assignation de rôles, où l'essentiel
 * de l'attention doit porter sur les trois escalades à bloquer.
 *
 * Aucun contrôleur : la consultation du journal est une feature à part entière,
 * avec sa pagination et ses filtres, et elle appartient à un sprint ultérieur.
 * Ce module ne fait qu'écrire.
 */
@Module({
  providers: [
    { provide: AuditLogRepository, useClass: PrismaAuditLogRepository },
    AuditRecorder,
  ],
  exports: [AuditRecorder],
})
export class AuditModule {}
