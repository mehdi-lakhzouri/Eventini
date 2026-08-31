import type { EmailTemplateId } from '../domain/email-template';
import { accountCreatedTemplate } from './account-created.template';
import { mfaDisabledTemplate } from './mfa-disabled.template';
import { mfaEnabledTemplate } from './mfa-enabled.template';
import { passwordChangedTemplate } from './password-changed.template';
import { passwordResetTemplate } from './password-reset.template';
import { sessionRevokedTemplate } from './session-revoked.template';
import { suspiciousLoginTemplate } from './suspicious-login.template';
import type { EmailTemplateDefinition } from './template.types';
import { verifyEmailTemplate } from './verify-email.template';

export const EMAIL_TEMPLATE_REGISTRY = {
  'account-created': accountCreatedTemplate,
  'verify-email': verifyEmailTemplate,
  'password-reset': passwordResetTemplate,
  'password-changed': passwordChangedTemplate,
  'mfa-enabled': mfaEnabledTemplate,
  'mfa-disabled': mfaDisabledTemplate,
  'suspicious-login': suspiciousLoginTemplate,
  'session-revoked': sessionRevokedTemplate,
} as const satisfies {
  [K in EmailTemplateId]: EmailTemplateDefinition<K>;
};
