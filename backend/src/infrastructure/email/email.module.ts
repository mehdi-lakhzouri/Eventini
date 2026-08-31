import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { mailConfig } from '../../config/mail.config';
import { redisConfig } from '../../config/redis.config';
import { EmailSender } from './domain/email-sender';
import { EmailEventPublisher } from './email-event.publisher';
import { EmailRenderer } from './email-renderer';
import { SmtpEmailSender } from './smtp-email-sender';
import { TransactionalEmailProcessor } from './transactional-email.processor';
import {
  TRANSACTIONAL_EMAIL_QUEUE,
  TransactionalEmailService,
} from './transactional-email.service';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [redisConfig.KEY],
      useFactory: (settings: ConfigType<typeof redisConfig>) => ({
        connection: {
          url: settings.url,
          db: settings.queueDb,
          maxRetriesPerRequest: null,
          ...(settings.tlsEnabled ? { tls: {} } : {}),
        },
        prefix: 'eventini:bull',
      }),
    }),
    BullModule.registerQueue({ name: TRANSACTIONAL_EMAIL_QUEUE }),
  ],
  providers: [
    EmailRenderer,
    TransactionalEmailService,
    TransactionalEmailProcessor,
    EmailEventPublisher,
    {
      provide: EmailSender,
      inject: [mailConfig.KEY],
      useFactory: (settings: ConfigType<typeof mailConfig>) =>
        new SmtpEmailSender({
          ...settings.smtp,
          from: settings.from,
          replyTo: settings.replyTo,
        }),
    },
  ],
  exports: [EmailRenderer, TransactionalEmailService, EmailEventPublisher],
})
export class EmailModule {}
