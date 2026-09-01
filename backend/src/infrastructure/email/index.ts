export { EmailModule } from './email.module';
export { EmailRenderer } from './email-renderer';
export { EmailEventPublisher } from './email-event.publisher';
export { TransactionalEmailService } from './transactional-email.service';
export { EmailSender } from './domain/email-sender';
export {
  EMAIL_EVENT_TO_TEMPLATE,
  EMAIL_TEMPLATE_IDS,
  type EmailEventType,
  type EmailPayloadByTemplate,
  type EmailTemplateId,
  type TransactionalEmailEvent,
  type TransactionalEmailMessage,
} from './domain/email-template';
