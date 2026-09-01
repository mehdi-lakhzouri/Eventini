import { Injectable } from '@nestjs/common';

import { EmailEventPublisher } from '../../../../infrastructure/email';
import { RevocationRepository } from '../domain/revocation.repository';

@Injectable()
export class RevokeSessionUseCase {
  constructor(
    private readonly sessions: RevocationRepository,
    private readonly emailEvents: EmailEventPublisher,
  ) {}

  /**
   * Ownership is part of the WHERE clause, not a check before it: a caller
   * revoking someone else's session finds nothing to revoke, and the answer
   * is the same as for a session id that never existed. Reporting the
   * difference would confirm that another user's session id is real.
   */
  async execute(input: {
    callerId: string;
    sessionId: string;
  }): Promise<boolean> {
    const now = new Date();
    const revoked = await this.sessions.revokeSession({
      sessionId: input.sessionId,
      userId: input.callerId,
      revokedBy: input.callerId,
      reason: 'USER_LOGOUT',
      now,
    });

    if (revoked) {
      await this.emailEvents.publish({
        type: 'SESSION_REVOKED',
        userId: input.callerId,
        sessionId: input.sessionId,
        occurredAt: now,
      });
    }

    return revoked;
  }
}
