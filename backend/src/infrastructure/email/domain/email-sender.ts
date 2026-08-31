export interface EmailAttachment {
  readonly filename: string;
  readonly content: Buffer;
  readonly contentType: string;
  readonly cid: string;
}

export interface EmailDelivery {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly attachments: readonly EmailAttachment[];
}

export interface EmailDeliveryReceipt {
  readonly messageId: string;
  readonly provider: string;
}

/** Provider port. Templates and application services never import Nodemailer. */
export abstract class EmailSender {
  abstract send(message: EmailDelivery): Promise<EmailDeliveryReceipt>;
}
