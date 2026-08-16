import { Module } from '@nestjs/common';

import { SecurityEventRecorder } from './application/security-event-recorder.service';
import { SecurityEventRepository } from './domain/security-event.repository';
import { PrismaSecurityEventRepository } from './infrastructure/prisma-security-event.repository';

/**
 * Le journal des événements de sécurité — EVT-077.
 *
 * Le module existait en squelette vide depuis le sprint 02, déjà importé par
 * `AuthenticationModule` et `IdentityModule`. Huit tickets annonçaient écrire
 * dans `security_events` ; la table n'avait **aucun écrivain** dans tout le
 * dépôt et les événements partaient en logs Pino. Ce ticket construit
 * l'écrivain face à l'ensemble de ses émetteurs, plutôt qu'autour d'un seul cas
 * — le dessiner pour `ROLE_CHANGED` l'aurait mal dessiné pour les 32 autres.
 *
 * Aucun contrôleur. La consultation du journal est une feature à part entière,
 * avec sa pagination, ses filtres et sa question d'autorisation croisée
 * (`platform.*` pour la vue inter-tenants, un filtre `organizationId` fourni
 * par l'appelant pour la vue tenant — voir `tenant-ownership.ts`). Elle
 * appartient à un sprint ultérieur. Ce module ne fait qu'écrire.
 */
@Module({
  providers: [
    {
      provide: SecurityEventRepository,
      useClass: PrismaSecurityEventRepository,
    },
    SecurityEventRecorder,
  ],
  exports: [SecurityEventRecorder],
})
export class SecurityEventsModule {}
