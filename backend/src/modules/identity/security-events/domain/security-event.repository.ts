import type {
  SecurityEventResult,
  SecurityEventSeverity,
  SecurityEventType,
} from '../../../../infrastructure/database/enums';

/** Une ligne de `security_events`, telle qu'elle part en base. */
export interface SecurityEventRecord {
  readonly eventType: SecurityEventType;
  readonly severity: SecurityEventSeverity;
  readonly result: SecurityEventResult;
  readonly reasonCode: string | null;

  /*
    Chaque champ d'acteur est nullable, et c'est structurel : un événement de
    sécurité peut précéder l'identité entièrement. Un login raté n'a pas
    d'utilisateur, un rejet d'origine n'a pas de session, une action plateforme
    n'a pas d'organisation.
  */
  readonly userId: string | null;
  readonly sessionId: string | null;
  readonly organizationId: string | null;
  readonly membershipId: string | null;
  readonly deviceId: string | null;

  readonly requestId: string | null;
  readonly traceId: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;

  readonly metadata: Record<string, unknown>;
  readonly occurredAt: Date;
}

/**
 * L'écriture dans `security_events` — EVT-077.
 *
 * ## 🔴 Aucun client transactionnel, à l'inverse d'`AuditLogRepository`
 *
 * `AuditLogRepository.record` **exige** la transaction de l'appelant en
 * premier paramètre : une entrée d'audit doit tomber avec le changement
 * qu'elle décrit, sinon un échec entre les deux laisse un changement sans
 * trace.
 *
 * Ici c'est l'inverse, et pour une raison symétrique. Les événements qui
 * comptent le plus — `LOGIN_FAILED`, `TENANT_ACCESS_DENIED`,
 * `REFRESH_TOKEN_REUSE_DETECTED` — sont émis précisément quand **rien n'est
 * commité**. Les écrire dans la transaction de l'appelant les ferait
 * disparaître avec le rollback : la table serait vide exactement des lignes
 * pour lesquelles elle existe.
 *
 * D'où la règle d'emploi, tenue par `__architecture__/security-event-emission.spec.ts` :
 * l'audit s'écrit **dans** le repository, à l'intérieur de la transaction ;
 * l'événement de sécurité s'écrit **dans le use case**, une fois la
 * transaction rendue. Un succès émis avant le commit affirmerait un changement
 * qui peut encore échouer.
 */
export abstract class SecurityEventRepository {
  abstract record(event: SecurityEventRecord): Promise<void>;
}
