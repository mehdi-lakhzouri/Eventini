import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import {
  ParticipantRepository,
  type ParticipantAuditFacts,
  type ParticipantRemoval,
} from '../domain/participant.repository';
import { cleanOptionalText } from '../domain/participant-values';

/**
 * Soft deletion — `participants` is SOFT_DELETE (DATABASE_SCHEMA.md §2.5).
 *
 * The row stays, so the audit trail keeps pointing at something, and its
 * email stops counting toward `ux_participants_org_email_active`, so the same
 * person can be created again.
 *
 * Refusing to delete a participant who still holds an active registration is
 * owed by EVT-056: the `registrations` table does not exist yet.
 */
@Injectable()
export class DeleteParticipantUseCase {
  constructor(private readonly participants: ParticipantRepository) {}

  execute(input: {
    context: TenantContext;
    participantId: string;
    reason: string | null;
    facts: ParticipantAuditFacts;
  }): Promise<ParticipantRemoval> {
    return this.participants.remove(
      input.context,
      input.participantId,
      cleanOptionalText(input.reason),
      input.facts,
    );
  }
}
