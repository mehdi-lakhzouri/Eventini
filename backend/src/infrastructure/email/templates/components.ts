import type {
  EmailDetailView,
  EmailNoticeView,
  EmailTone,
} from './template.types';

export const detail = (
  symbol: string,
  label: string,
  value: string,
): EmailDetailView => ({ symbol, label, value });

export const notice = (
  tone: EmailTone,
  symbol: string,
  text: string,
  title?: string,
): EmailNoticeView => ({ tone, symbol, text, title });

export const securityNote = (
  text: string,
  tone: EmailTone = 'neutral',
  title?: string,
) => ({ text, tone, title });
