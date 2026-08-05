import { Injectable } from '@nestjs/common';

import {
  RevocationRepository,
  type SessionSummary,
} from '../domain/revocation.repository';

@Injectable()
export class ListUserSessionsUseCase {
  constructor(private readonly sessions: RevocationRepository) {}

  async execute(input: {
    callerId: string;
    currentSessionId: string;
  }): Promise<SessionSummary[]> {
    const sessions = await this.sessions.listActiveSessions(input.callerId);

    return sessions.map((session) => ({
      ...session,
      current: session.sessionId === input.currentSessionId,
    }));
  }
}
