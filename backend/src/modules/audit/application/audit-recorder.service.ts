import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import type { TransactionalClient } from '../../../infrastructure/database/transaction.manager';
import { AuditLogRepository } from '../domain/audit-log.repository';

/** Ce que l'appelant décrit : l'action, pas l'acteur. */
export interface AuditableAction {
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly previousValues?: Record<string, unknown> | null;
  readonly newValues?: Record<string, unknown> | null;
  readonly reason?: string | null;
}

/** Ce que la requête apporte, et que le contexte tenant ne porte pas. */
export interface AuditRequestFacts {
  readonly requestId: string | null;
  readonly ipAddress: string | null;
  /** Le rôle de l'acteur au moment de l'action, en texte. */
  readonly actorRole: string | null;
}

/**
 * Enregistre une action métier — EVT-076.
 *
 * Le service existe pour que l'appelant ne décrive que **ce qu'il a fait**.
 * L'acteur, sa session et son organisation viennent du `TenantContext`, qui
 * les porte déjà : les faire remplir par chaque use case serait quatre
 * occasions de se tromper, et un `actorUserId` erroné dans une piste d'audit
 * est pire qu'une piste absente — il accuse quelqu'un.
 *
 * 🔴 Le client transactionnel reste **obligatoire et premier**. EVT-044 et
 * EVT-045 exigent l'entrée dans la même transaction que le changement : hors
 * transaction, un échec entre les deux laisse un changement sans trace, ce qui
 * est exactement l'état qu'un audit doit rendre impossible.
 */
@Injectable()
export class AuditRecorder {
  constructor(private readonly repository: AuditLogRepository) {}

  async record(
    tx: TransactionalClient,
    context: TenantContext,
    action: AuditableAction,
    facts: AuditRequestFacts,
  ): Promise<void> {
    await this.repository.record(tx, {
      actorUserId: context.userId,
      actorSessionId: context.sessionId,
      actorRole: facts.actorRole,
      organizationId: context.organizationId,
      targetType: action.targetType,
      targetId: action.targetId,
      action: action.action,
      previousValues: action.previousValues ?? null,
      newValues: action.newValues ?? null,
      reason: action.reason ?? null,
      requestId: facts.requestId,
      ipAddress: facts.ipAddress,
    });
  }

  /**
   * Une action de portée plateforme, ou système.
   *
   * `organizationId` à `null` est une valeur légitime — une purge de
   * rétention, un job planifié, une opération `SUPER_ADMIN` hors tenant
   * (ADR-0002). Une surcharge distincte plutôt qu'un `TenantContext` optionnel :
   * rendre le contexte facultatif ferait de l'oubli le cas par défaut, et une
   * entrée d'audit sans organisation passerait inaperçue là où elle en avait
   * une.
   */
  async recordPlatformAction(
    tx: TransactionalClient,
    actor: { userId: string | null; sessionId: string | null },
    action: AuditableAction,
    facts: AuditRequestFacts,
  ): Promise<void> {
    await this.repository.record(tx, {
      actorUserId: actor.userId,
      actorSessionId: actor.sessionId,
      actorRole: facts.actorRole,
      organizationId: null,
      targetType: action.targetType,
      targetId: action.targetId,
      action: action.action,
      previousValues: action.previousValues ?? null,
      newValues: action.newValues ?? null,
      reason: action.reason ?? null,
      requestId: facts.requestId,
      ipAddress: facts.ipAddress,
    });
  }
}
