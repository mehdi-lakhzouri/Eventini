import Handlebars from 'handlebars';
import { Injectable } from '@nestjs/common';

import {
  bufferDataUri,
  EMAIL_ICON_CID,
  EMAIL_LOGO_CID,
  renderEmailAssets,
} from './assets/eventini-email-assets';
import type { EmailDelivery } from './domain/email-sender';
import {
  parseTransactionalEmailMessage,
  type TransactionalEmailMessage,
} from './domain/email-template';
import { EMAIL_TEMPLATE_REGISTRY } from './templates/template-registry';
import type { EmailTemplateView, EmailTone } from './templates/template.types';
import { TRANSACTIONAL_EMAIL_LAYOUT } from './templates/transactional-email.layout';

const htmlTemplate = Handlebars.compile(TRANSACTIONAL_EMAIL_LAYOUT, {
  strict: true,
  noEscape: false,
});

const toneStyles: Record<
  EmailTone,
  { backgroundColor: string; borderColor: string; accentColor: string }
> = {
  info: {
    backgroundColor: '#EEF2FF',
    borderColor: '#A8B4FF',
    accentColor: '#222F90',
  },
  success: {
    backgroundColor: '#F0FDF4',
    borderColor: '#86E0AA',
    accentColor: '#16A34A',
  },
  danger: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FDA4A4',
    accentColor: '#DC2626',
  },
  neutral: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    accentColor: '#64748B',
  },
};

const iconToneStyles: Record<EmailTone, { background: string; halo: string }> =
  {
    info: { background: '#EEF2FF', halo: '#F5F7FF' },
    success: { background: '#F0FDF4', halo: '#E8F8EF' },
    danger: { background: '#FEF2F2', halo: '#FFF0ED' },
    neutral: { background: '#F8FAFC', halo: '#F1F5F9' },
  };

export interface RenderEmailOptions {
  /** Used only by the local preview generator. Sending uses CID attachments. */
  readonly embedAssets?: boolean;
}

@Injectable()
export class EmailRenderer {
  async render(
    input: unknown,
    options: RenderEmailOptions = {},
  ): Promise<EmailDelivery> {
    const message = parseTransactionalEmailMessage(input);
    const definition = EMAIL_TEMPLATE_REGISTRY[message.templateId];
    const view = buildView(message);
    const assets = await renderEmailAssets(view.icon, view.iconTone);
    const logo = assets[0];
    const icon = assets[1];

    if (logo === undefined || icon === undefined) {
      throw new Error('Transactional email assets are incomplete.');
    }

    const embed = options.embedAssets === true;
    const html = htmlTemplate({
      ...decorateView(view),
      logoSource: embed ? bufferDataUri(logo) : `cid:${EMAIL_LOGO_CID}`,
      iconSource: embed ? bufferDataUri(icon) : `cid:${EMAIL_ICON_CID}`,
    });

    return {
      to: message.to,
      subject: definition.subject,
      html,
      text: renderPlainText(view),
      attachments: embed ? [] : assets,
    };
  }
}

function buildView(message: TransactionalEmailMessage): EmailTemplateView {
  switch (message.templateId) {
    case 'account-created':
      return EMAIL_TEMPLATE_REGISTRY['account-created'].build(message.payload);
    case 'verify-email':
      return EMAIL_TEMPLATE_REGISTRY['verify-email'].build(message.payload);
    case 'password-reset':
      return EMAIL_TEMPLATE_REGISTRY['password-reset'].build(message.payload);
    case 'password-changed':
      return EMAIL_TEMPLATE_REGISTRY['password-changed'].build(message.payload);
    case 'mfa-enabled':
      return EMAIL_TEMPLATE_REGISTRY['mfa-enabled'].build(message.payload);
    case 'mfa-disabled':
      return EMAIL_TEMPLATE_REGISTRY['mfa-disabled'].build(message.payload);
    case 'suspicious-login':
      return EMAIL_TEMPLATE_REGISTRY['suspicious-login'].build(message.payload);
    case 'session-revoked':
      return EMAIL_TEMPLATE_REGISTRY['session-revoked'].build(message.payload);
  }
}

function decorateView(view: EmailTemplateView) {
  const icon = iconToneStyles[view.iconTone];
  return {
    ...view,
    iconBackground: icon.background,
    iconHalo: icon.halo,
    details: view.details?.map((row, index, rows) => ({
      ...row,
      rowBorder: index === rows.length - 1 ? '0' : '1px solid #e2e8f0',
    })),
    notices: view.notices?.map((item) => ({
      ...item,
      ...toneStyles[item.tone],
    })),
    securityNote:
      view.securityNote === undefined
        ? undefined
        : {
            ...view.securityNote,
            accentColor: toneStyles[view.securityNote.tone].accentColor,
          },
  };
}

function renderPlainText(view: EmailTemplateView): string {
  const lines = [view.title, '', ...view.paragraphs, ''];

  if (view.details !== undefined) {
    for (const row of view.details) {
      lines.push(`${row.label}: ${row.value}`);
    }
    lines.push('');
  }

  if (view.primaryButton !== undefined) {
    lines.push(`${view.primaryButton.label}:`, view.primaryButton.url, '');
  }
  if (view.secondaryButton !== undefined) {
    lines.push(`${view.secondaryButton.label}:`, view.secondaryButton.url, '');
  }
  for (const item of view.notices ?? []) {
    if (item.title !== undefined) lines.push(item.title);
    lines.push(item.text, '');
  }
  if (view.fallback !== undefined) {
    lines.push(view.fallback.introduction, view.fallback.url, '');
  }
  if (view.securityNote !== undefined) {
    if (view.securityNote.title !== undefined) {
      lines.push(view.securityNote.title);
    }
    lines.push(view.securityNote.text, '');
  }

  lines.push(
    "Besoin d'aide ? Notre équipe est là pour vous.",
    `Contacter le support: ${view.supportUrl}`,
    '',
    '© Eventini — Tous droits réservés.',
  );

  return lines
    .join('\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
}
