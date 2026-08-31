import { z } from 'zod';

const safeText = z.string().trim().min(1).max(500);
const firstName = safeText.max(120);
const dateText = safeText.max(160);
const actionUrl = z
  .url()
  .max(4_096)
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
    message: 'Email action URLs must use HTTP or HTTPS.',
  });
const common = {
  firstName,
  supportUrl: actionUrl,
};

export const emailPayloadSchemas = {
  'account-created': z.object({
    ...common,
    loginUrl: actionUrl,
  }),
  'verify-email': z.object({
    ...common,
    email: z.email().max(320),
    verificationUrl: actionUrl,
    expiresIn: safeText.max(80),
  }),
  'password-reset': z.object({
    ...common,
    resetPasswordUrl: actionUrl,
    expiresIn: safeText.max(80),
  }),
  'password-changed': z.object({
    ...common,
    changedAt: dateText,
    device: safeText,
    location: safeText,
    maskedIp: safeText.max(80),
    securityUrl: actionUrl,
  }),
  'mfa-enabled': z.object({
    ...common,
    enabledAt: dateText,
    securitySettingsUrl: actionUrl,
  }),
  'mfa-disabled': z.object({
    ...common,
    disabledAt: dateText,
    securityUrl: actionUrl,
    mfaSetupUrl: actionUrl,
  }),
  'suspicious-login': z.object({
    ...common,
    loginAt: dateText,
    device: safeText,
    browser: safeText,
    location: safeText,
    maskedIp: safeText.max(80),
    securityIncidentUrl: actionUrl,
  }),
  'session-revoked': z.object({
    ...common,
    device: safeText,
    lastActivityAt: dateText,
    location: safeText,
    securityUrl: actionUrl,
  }),
} as const;

export type EmailTemplateId = keyof typeof emailPayloadSchemas;
export const EMAIL_TEMPLATE_IDS = Object.freeze(
  Object.keys(emailPayloadSchemas) as EmailTemplateId[],
);

export type AccountCreatedPayload = z.infer<
  (typeof emailPayloadSchemas)['account-created']
>;
export type VerifyEmailPayload = z.infer<
  (typeof emailPayloadSchemas)['verify-email']
>;
export type PasswordResetPayload = z.infer<
  (typeof emailPayloadSchemas)['password-reset']
>;
export type PasswordChangedPayload = z.infer<
  (typeof emailPayloadSchemas)['password-changed']
>;
export type MfaEnabledPayload = z.infer<
  (typeof emailPayloadSchemas)['mfa-enabled']
>;
export type MfaDisabledPayload = z.infer<
  (typeof emailPayloadSchemas)['mfa-disabled']
>;
export type SuspiciousLoginPayload = z.infer<
  (typeof emailPayloadSchemas)['suspicious-login']
>;
export type SessionRevokedPayload = z.infer<
  (typeof emailPayloadSchemas)['session-revoked']
>;

export type EmailPayloadByTemplate = {
  'account-created': AccountCreatedPayload;
  'verify-email': VerifyEmailPayload;
  'password-reset': PasswordResetPayload;
  'password-changed': PasswordChangedPayload;
  'mfa-enabled': MfaEnabledPayload;
  'mfa-disabled': MfaDisabledPayload;
  'suspicious-login': SuspiciousLoginPayload;
  'session-revoked': SessionRevokedPayload;
};

export type TransactionalEmailMessage = {
  [K in EmailTemplateId]: {
    readonly templateId: K;
    readonly to: string;
    readonly payload: EmailPayloadByTemplate[K];
    /** Safe correlation id. Never an action token or URL. */
    readonly eventId?: string;
  };
}[EmailTemplateId];

const messageSchemas = Object.entries(emailPayloadSchemas).map(
  ([templateId, payload]) =>
    z.object({
      templateId: z.literal(templateId as EmailTemplateId),
      to: z.email().max(320),
      payload,
      eventId: z.string().trim().min(1).max(160).optional(),
    }),
);

export function parseTransactionalEmailMessage(
  input: unknown,
): TransactionalEmailMessage {
  for (const schema of messageSchemas) {
    const result = schema.safeParse(input);
    if (result.success) {
      return result.data as TransactionalEmailMessage;
    }
  }

  throw new Error('Invalid transactional email message.');
}

export type EmailEventType =
  | 'USER_CREATED'
  | 'EMAIL_VERIFICATION_REQUESTED'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_CHANGED'
  | 'MFA_ENABLED'
  | 'MFA_DISABLED'
  | 'SUSPICIOUS_LOGIN_DETECTED'
  | 'SESSION_REVOKED';

export const EMAIL_EVENT_TO_TEMPLATE = {
  USER_CREATED: 'account-created',
  EMAIL_VERIFICATION_REQUESTED: 'verify-email',
  PASSWORD_RESET_REQUESTED: 'password-reset',
  PASSWORD_CHANGED: 'password-changed',
  MFA_ENABLED: 'mfa-enabled',
  MFA_DISABLED: 'mfa-disabled',
  SUSPICIOUS_LOGIN_DETECTED: 'suspicious-login',
  SESSION_REVOKED: 'session-revoked',
} as const satisfies Record<EmailEventType, EmailTemplateId>;

export type TransactionalEmailEvent =
  | { type: 'USER_CREATED'; userId: string; occurredAt: Date }
  | {
      type: 'EMAIL_VERIFICATION_REQUESTED';
      userId: string;
      verificationToken: string;
      expiresInSeconds: number;
      occurredAt: Date;
    }
  | {
      type: 'PASSWORD_RESET_REQUESTED';
      userId: string;
      resetToken: string;
      expiresInSeconds: number;
      occurredAt: Date;
    }
  | {
      type: 'PASSWORD_CHANGED';
      userId: string;
      occurredAt: Date;
      ipAddress?: string | null;
      userAgent?: string | null;
    }
  | { type: 'MFA_ENABLED'; userId: string; occurredAt: Date }
  | { type: 'MFA_DISABLED'; userId: string; occurredAt: Date }
  | {
      type: 'SUSPICIOUS_LOGIN_DETECTED';
      userId: string;
      occurredAt: Date;
      ipAddress?: string | null;
      userAgent?: string | null;
      location?: string | null;
    }
  | {
      type: 'SESSION_REVOKED';
      userId: string;
      sessionId: string;
      occurredAt: Date;
    };
