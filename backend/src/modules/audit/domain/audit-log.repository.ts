import type { TransactionalClient } from '../../../infrastructure/database/transaction.manager';

/**
 * Une entrée du journal d'audit métier — `DATABASE_SCHEMA.md` §8.
 *
 * ## Ce que ce journal n'est pas
 *
 * Ce n'est ni `security_events`, ni les logs applicatifs. `security_events`
 * enregistre ce qui menace le système — connexions refusées, rejeu de jeton,
 * accès cross-tenant. Le journal d'audit enregistre ce que des personnes ont
 * **délibérément fait aux données** : qui a renommé, assigné, révoqué, et à
 * quoi ressemblait la valeur avant.
 *
 * Les confondre a une conséquence pratique : les deux n'ont pas les mêmes
 * lecteurs, ni la même rétention, ni la même sensibilité. Un auditeur cherche
 * « qui a retiré ce rôle » ; un analyste sécurité cherche « qui a tenté
 * d'entrer ». Mélanger les deux flux rend les deux recherches plus difficiles.
 */
export interface AuditEntry {
  /** Qui. `null` pour une action système — un purge de rétention, un job. */
  readonly actorUserId: string | null;
  readonly actorSessionId: string | null;

  /**
   * Le rôle de l'acteur **au moment de l'action**, en texte.
   *
   * Une chaîne et non une clé étrangère, et le schéma insiste : une clé
   * étrangère ferait changer la piste d'audit rétroactivement quand le rôle
   * est renommé, révoqué ou supprimé. Le compte rendu de ce que quelqu'un
   * avait le droit de faire serait alors réécrit par des événements
   * postérieurs — ce qui n'est plus une piste d'audit.
   */
  readonly actorRole: string | null;

  /** `null` pour une action de portée plateforme. */
  readonly organizationId: string | null;

  readonly targetType: string;
  readonly targetId: string | null;
  readonly action: string;

  /**
   * Avant et après.
   *
   * Passent par `buildAuditDiff`, qui **remplace** les champs sensibles par
   * `[REDACTED]` sans jamais les omettre : une clé absente dirait que la
   * valeur n'a pas changé, ce qui est exactement l'inverse de la vérité et
   * exactement ce que quelqu'un couvrant ses traces voudrait qu'elle dise.
   */
  readonly previousValues: Record<string, unknown> | null;
  readonly newValues: Record<string, unknown> | null;

  /** Justification libre, quand l'opération en demande une. */
  readonly reason?: string | null;

  readonly requestId: string | null;
  readonly ipAddress: string | null;
}

/**
 * L'écriture du journal d'audit.
 *
 * ## 🔴 Pourquoi la méthode prend une transaction
 *
 * EVT-044 et EVT-045 exigent l'entrée d'audit **dans la même transaction** que
 * le changement qu'elle décrit. Ce n'est pas une préférence de style : hors
 * transaction, un échec entre les deux écritures laisse soit un changement
 * sans trace — le pire des deux, puisque plus rien ne dit qu'il a eu lieu —
 * soit une trace d'un changement qui n'a pas eu lieu.
 *
 * Le port impose donc le client transactionnel en premier paramètre. Une
 * signature qui le rendrait facultatif serait une signature qu'on oublierait
 * de remplir, et l'oubli serait invisible : le journal contiendrait une
 * entrée, simplement pas atomique avec son sujet.
 *
 * La table est **append-only**, garanti par `trg_audit_logs_append_only` : il
 * n'y a ni mise à jour ni suppression, donc ce port n'expose qu'une écriture.
 */
export abstract class AuditLogRepository {
  abstract record(tx: TransactionalClient, entry: AuditEntry): Promise<void>;
}
