import type { SessionEntity } from '../domain/session.entity';
import { SessionRepository } from '../domain/session.repository';

export class PrismaSessionRepository implements SessionRepository {
  findById(_sessionId: string): Promise<SessionEntity | null> {
    throw new Error('Not implemented');
  }
}
