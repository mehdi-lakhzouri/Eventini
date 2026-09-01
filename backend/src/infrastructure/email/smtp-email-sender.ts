import nodemailer from 'nodemailer';

import type { EmailDelivery } from './domain/email-sender';
import { EmailSender, type EmailDeliveryReceipt } from './domain/email-sender';

export interface SmtpEmailSenderSettings {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  readonly password: string;
  readonly from: { readonly address: string; readonly name: string };
  readonly replyTo?: string;
}

/** Nodemailer is an adapter detail; callers only depend on EmailSender. */
export class SmtpEmailSender extends EmailSender {
  private readonly transport;

  constructor(private readonly settings: SmtpEmailSenderSettings) {
    super();
    this.transport = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: { user: settings.user, pass: settings.password },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
    });
  }

  async send(message: EmailDelivery): Promise<EmailDeliveryReceipt> {
    const receipt = await this.transport.sendMail({
      from: {
        name: this.settings.from.name,
        address: this.settings.from.address,
      },
      replyTo: this.settings.replyTo,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: message.attachments.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType: attachment.contentType,
        cid: attachment.cid,
        contentDisposition: 'inline',
      })),
      headers: {
        'X-Entity-Ref-ID': `eventini-${Date.now()}`,
        'X-Auto-Response-Suppress': 'All',
      },
    });

    return {
      messageId: receipt.messageId ?? 'smtp-unavailable-message-id',
      provider: 'smtp',
    };
  }
}
