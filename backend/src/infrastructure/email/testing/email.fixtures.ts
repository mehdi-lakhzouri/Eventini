import type { TransactionalEmailMessage } from '../domain/email-template';

const common = {
  firstName: 'Mehdi',
  supportUrl: 'https://app.eventini.test/support',
};

export const EMAIL_PREVIEW_MESSAGES: readonly TransactionalEmailMessage[] = [
  {
    templateId: 'account-created',
    to: 'mehdi@example.com',
    payload: { ...common, loginUrl: 'https://app.eventini.test/login' },
  },
  {
    templateId: 'verify-email',
    to: 'mehdi@example.com',
    payload: {
      ...common,
      email: 'mehdi@example.com',
      verificationUrl:
        'https://app.eventini.test/verify-email?token=preview-token',
      expiresIn: '24 heures',
    },
  },
  {
    templateId: 'password-reset',
    to: 'mehdi@example.com',
    payload: {
      ...common,
      resetPasswordUrl:
        'https://app.eventini.test/reset-password?token=preview-token',
      expiresIn: '30 minutes',
    },
  },
  {
    templateId: 'password-changed',
    to: 'mehdi@example.com',
    payload: {
      ...common,
      changedAt: '16 août 2026 à 12:19 UTC',
      device: 'Chrome 151 sur Windows',
      location: 'Tunis, Tunisie (approximative)',
      maskedIp: '197.***.***.42',
      securityUrl: 'https://app.eventini.test/account/security',
    },
  },
  {
    templateId: 'mfa-enabled',
    to: 'mehdi@example.com',
    payload: {
      ...common,
      enabledAt: '16 août 2026 à 12:19 UTC',
      securitySettingsUrl: 'https://app.eventini.test/account/security',
    },
  },
  {
    templateId: 'mfa-disabled',
    to: 'mehdi@example.com',
    payload: {
      ...common,
      disabledAt: '16 août 2026 à 12:19 UTC',
      securityUrl: 'https://app.eventini.test/account/security',
      mfaSetupUrl: 'https://app.eventini.test/account/security#mfa',
    },
  },
  {
    templateId: 'suspicious-login',
    to: 'mehdi@example.com',
    payload: {
      ...common,
      loginAt: '16 août 2026 à 12:19 UTC',
      device: 'Chrome sur Windows',
      browser: 'Chrome 151',
      location: 'Tunis, Tunisie (approximative)',
      maskedIp: '197.***.***.42',
      securityIncidentUrl:
        'https://app.eventini.test/account/security?incident=login',
    },
  },
  {
    templateId: 'session-revoked',
    to: 'mehdi@example.com',
    payload: {
      ...common,
      device: 'Chrome sur Windows',
      lastActivityAt: '16 août 2026 à 12:12 UTC',
      location: 'Tunis, Tunisie (approximative)',
      securityUrl: 'https://app.eventini.test/account/security',
    },
  },
];
