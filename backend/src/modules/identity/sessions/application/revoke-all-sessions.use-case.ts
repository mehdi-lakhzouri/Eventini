import { Injectable } from '@nestjs/common';

import { RevocationRepository } from '../domain/revocation.repository';

@Injectable()
export class RevokeAllSessionsUseCase {
  constructor(private readonly sessions: RevocationRepository) {}

  /** Includes the caller's own session: a global logout logs out everywhere. */
  async execute(callerId: string): Promise<number> {
    return this.sessions.revokeAllSessions({
      userId: callerId,
      revokedBy: callerId,
      reason: 'ALL_SESSIONS_REVOKED',
      now: new Date(),
    });
  }
}
