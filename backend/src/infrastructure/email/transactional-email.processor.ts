import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';

import { MetricsService } from '../metrics';
import { EmailSender } from './domain/email-sender';
import {
  parseTransactionalEmailMessage,
  type TransactionalEmailMessage,
} from './domain/email-template';
import { EmailRenderer } from './email-renderer';
import { TRANSACTIONAL_EMAIL_QUEUE } from './transactional-email.service';

@Processor(TRANSACTIONAL_EMAIL_QUEUE, { concurrency: 5 })
export class TransactionalEmailProcessor extends WorkerHost {
  constructor(
    private readonly renderer: EmailRenderer,
    private readonly sender: EmailSender,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService,
  ) {
    super();
  }

  async process(job: Job<TransactionalEmailMessage>): Promise<void> {
    const startedAt = performance.now();
    const attempt = job.attemptsMade + 1;
    const message = parseTransactionalEmailMessage(job.data);

    this.logger.info(
      {
        category: 'QUEUE',
        eventCode: 'JOB_STARTED',
        queueName: TRANSACTIONAL_EMAIL_QUEUE,
        emailType: message.templateId,
        deliveryStatus: 'STARTED',
        attempt,
        eventId: message.eventId,
      },
      'Transactional email delivery started',
    );

    try {
      const rendered = await this.renderer.render(message);
      const receipt = await this.sender.send(rendered);
      const durationMs = Math.round(performance.now() - startedAt);

      this.metrics.metrics.queueJobDurationSeconds.observe(
        { queueName: TRANSACTIONAL_EMAIL_QUEUE },
        durationMs / 1_000,
      );
      this.logger.info(
        {
          category: 'QUEUE',
          eventCode: 'JOB_SUCCEEDED',
          queueName: TRANSACTIONAL_EMAIL_QUEUE,
          emailType: message.templateId,
          messageId: receipt.messageId,
          provider: receipt.provider,
          deliveryStatus: 'SENT',
          attempt,
          durationMs,
          eventId: message.eventId,
        },
        'Transactional email delivered',
      );
    } catch (error: unknown) {
      const maximumAttempts = job.opts.attempts ?? 1;
      const final = attempt >= maximumAttempts;
      const durationMs = Math.round(performance.now() - startedAt);

      if (final) {
        this.metrics.metrics.queueJobsFailedTotal.inc({
          queueName: TRANSACTIONAL_EMAIL_QUEUE,
        });
      }
      this.logger.error(
        {
          category: 'QUEUE',
          eventCode: final ? 'JOB_FAILED_FINAL' : 'JOB_RETRY_SCHEDULED',
          queueName: TRANSACTIONAL_EMAIL_QUEUE,
          emailType: message.templateId,
          deliveryStatus: final ? 'FAILED' : 'RETRY_SCHEDULED',
          attempt,
          durationMs,
          eventId: message.eventId,
          err: error,
        },
        final
          ? 'Transactional email delivery failed permanently'
          : 'Transactional email delivery will be retried',
      );

      throw error;
    }
  }
}
