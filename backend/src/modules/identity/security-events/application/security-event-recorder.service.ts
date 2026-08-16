import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import type { TenantContext } from '../../../../common/types/tenant-context';
import { redactAuditValues } from '../../../../infrastructure/audit';
import type { SecurityEventType } from '../../../../infrastructure/database/enums';
import { profileFor } from '../domain/security-event-profile';
import { SecurityEventRepository } from '../domain/security-event.repository';

/**
 * Ce que le site d'émission apporte. Tout est facultatif : la moitié de ces
 * champs n'existe pas encore au moment où l'événement se produit.
 */
export interface SecurityEventFacts {
  /** Le pourquoi, en texte machine. Libre — voir la colonne dans le schéma. */
  readonly reasonCode?: string | null;

  readonly userId?: string | null;
  readonly sessionId?: string | null;
  readonly organizationId?: string | null;
  readonly membershipId?: string | null;
  readonly deviceId?: string | null;

  readonly requestId?: string | null;
  readonly traceId?: string | null;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;

  readonly metadata?: Record<string, unknown>;

  /**
   * Quand c'est arrivé, si ce n'est pas maintenant.
   *
   * La colonne existe séparément de `created_at` parce qu'un événement remonté
   * d'un job en file ou d'une synchronisation de scanner hors ligne peut être
   * écrit longtemps après le fait, et que l'analyse a besoin du premier.
   */
  readonly occurredAt?: Date;
}

/**
 * Enregistre un événement de sécurité — EVT-077.
 *
 * ## 🔴 Ne relance jamais
 *
 * Un échec d'écriture ici ne doit **pas** changer l'issue de la requête. Le
 * scénario à éviter est précis : la base est en difficulté, l'écriture de
 * l'événement échoue, et un login par ailleurs valide devient un 500 — ou pire,
 * un refus légitime devient un 500 qui ressemble à un bug alors que la défense
 * a fonctionné.
 *
 * L'inverse est tout aussi vrai : un échec silencieux est un angle mort, donc
 * chaque échec part en log sous `SECURITY_EVENT_WRITE_FAILED`, avec le type
 * qu'on n'a pas su écrire. C'est un code d'alerte, pas une ligne de debug — une
 * table de sécurité qui cesse de se remplir sans que personne ne le sache vaut
 * moins qu'une table absente, parce qu'on lui fait confiance.
 *
 * ## Hors de toute transaction, et après le commit
 *
 * Voir `SecurityEventRepository` : ce service s'appelle depuis un **use case**,
 * une fois la transaction rendue par le repository. Un succès émis avant le
 * commit affirmerait un changement qui peut encore échouer ; un échec émis dans
 * la transaction disparaîtrait avec le rollback.
 */
@Injectable()
export class SecurityEventRecorder {
  constructor(
    private readonly repository: SecurityEventRepository,
    private readonly logger: PinoLogger,
  ) {}

  async record(
    type: SecurityEventType,
    facts: SecurityEventFacts = {},
  ): Promise<void> {
    const profile = profileFor(type);

    try {
      await this.repository.record({
        eventType: type,
        severity: profile.severity,
        result: profile.result,
        reasonCode: facts.reasonCode ?? null,
        userId: facts.userId ?? null,
        sessionId: facts.sessionId ?? null,
        organizationId: facts.organizationId ?? null,
        membershipId: facts.membershipId ?? null,
        deviceId: facts.deviceId ?? null,
        requestId: facts.requestId ?? null,
        traceId: facts.traceId ?? null,
        ipAddress: facts.ipAddress ?? null,
        userAgent: facts.userAgent ?? null,
        metadata: redactMetadata(facts.metadata),
        occurredAt: facts.occurredAt ?? new Date(),
      });
    } catch (error: unknown) {
      this.logger.error(
        {
          category: 'SECURITY',
          eventCode: 'SECURITY_EVENT_WRITE_FAILED',
          securityEventType: type,
          severity: profile.severity,
          err: error,
        },
        'Failed to persist a security event',
      );
    }
  }

  /**
   * Le même, avec l'acteur rempli depuis le contexte tenant.
   *
   * Une surcharge distincte plutôt qu'un contexte optionnel sur `record` :
   * rendre le contexte facultatif ferait de l'oubli le cas par défaut, et un
   * événement sans `organization_id` là où il en avait un est invisible pour la
   * requête d'un administrateur d'organisation — c'est-à-dire perdu pour la
   * seule personne à qui il était destiné. Même motif qu'`AuditRecorder`.
   */
  async recordForContext(
    type: SecurityEventType,
    context: TenantContext,
    facts: SecurityEventFacts = {},
  ): Promise<void> {
    await this.record(type, {
      ...facts,
      userId: facts.userId ?? context.userId,
      sessionId: facts.sessionId ?? context.sessionId,
      organizationId: facts.organizationId ?? context.organizationId,
      membershipId: facts.membershipId ?? context.membershipId,
    });
  }
}

/**
 * Passe `metadata` par la liste de clés sensibles partagée.
 *
 * `redactAuditValues` vient d'`infrastructure/audit`, et le nom du dossier
 * désigne son premier appelant, pas son périmètre. Le réutiliser plutôt que
 * réécrire la même boucle est délibéré sur deux points : la **liste de clés**
 * ne doit pas diverger entre deux artefacts lus par la même personne, et le
 * remplacement par `[REDACTED]` est le bon comportement ici aussi.
 *
 * Ce dernier point mérite d'être dit : un scrubber de logs a le droit de
 * supprimer la clé, un événement de sécurité non. Une clé retirée en silence
 * masquerait le fait qu'un site d'émission a tenté d'enregistrer un secret —
 * ce qui est un bug qu'on veut voir, pas un problème qu'on veut cacher.
 *
 * §8 d'`AUTHENTICATION_AUTHORIZATION.md` liste ce qui n'est **jamais**
 * journalisé : mot de passe, access token, refresh token, cookie complet,
 * secret MFA, code de récupération, token de reset, token d'invitation,
 * payload QR complet.
 */
function redactMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (metadata === undefined) {
    return {};
  }

  return redactAuditValues(metadata) as Record<string, unknown>;
}
