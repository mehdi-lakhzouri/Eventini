import type {
  EmailPayloadByTemplate,
  EmailTemplateId,
} from '../domain/email-template';

export type EmailIcon =
  | 'user-check'
  | 'mail-check'
  | 'key'
  | 'shield-check'
  | 'shield-alert'
  | 'monitor-x';

export type EmailTone = 'info' | 'success' | 'danger' | 'neutral';

export interface EmailButtonView {
  readonly label: string;
  readonly url: string;
}

export interface EmailDetailView {
  readonly label: string;
  readonly value: string;
  readonly symbol: string;
}

export interface EmailNoticeView {
  readonly tone: EmailTone;
  readonly symbol: string;
  readonly title?: string;
  readonly text: string;
}

export interface EmailTemplateView {
  readonly preheader: string;
  readonly title: string;
  readonly icon: EmailIcon;
  readonly iconTone: EmailTone;
  readonly paragraphs: readonly string[];
  readonly details?: readonly EmailDetailView[];
  readonly primaryButton?: EmailButtonView;
  readonly secondaryButton?: EmailButtonView;
  readonly notices?: readonly EmailNoticeView[];
  readonly fallback?: {
    readonly introduction: string;
    readonly url: string;
  };
  readonly securityNote?: {
    readonly title?: string;
    readonly text: string;
    readonly tone: EmailTone;
  };
  readonly supportUrl: string;
}

export interface EmailTemplateDefinition<K extends EmailTemplateId> {
  readonly id: K;
  readonly subject: string;
  build(payload: EmailPayloadByTemplate[K]): EmailTemplateView;
}
