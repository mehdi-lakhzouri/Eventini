import type { SessionEntity } from './session.entity';

export abstract class SessionRepository {
  abstract findById(sessionId: string): Promise<SessionEntity | null>;
}
