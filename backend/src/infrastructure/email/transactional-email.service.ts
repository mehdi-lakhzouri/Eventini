import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';

import {
  parseTransactionalEmailMessage,
  type TransactionalEmailMessage,
} from './domain/email-template';

export const TRANSACTIONAL_EMAIL_QUEUE = 'transactional-email';

@Injectable()
export class TransactionalEmailService {
  constructor(
    @InjectQueue(TRANSACTIONAL_EMAIL_QUEUE)
    private readonly queue: Queue<TransactionalEmailMessage>,
  ) {}

  async enqueue(input: unknown): Promise<string> {
    const message = parseTransactionalEmailMessage(input);
    const job = await this.queue.add(message.templateId, message, {
      // Publisher-originated messages always carry the opaque event id. BullMQ
      // rejects a second add with the same job id while the completed-job
      // retention window is active, making a replay non-delivering.
      ...(message.eventId === undefined
        ? {}
        : { jobId: `eml_${message.eventId}` }),
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000, jitter: 0.2 },
      removeOnComplete: { age: 86_400, count: 5_000 },
      removeOnFail: { age: 604_800, count: 10_000 },
    });

    return String(job.id);
  }
}
