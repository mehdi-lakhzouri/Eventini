import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';

import { mailConfig } from '../../config/mail.config';
import { TENANT_SCOPED_PRISMA } from '../database/prisma.tokens';
import type { TenantScopedPrismaClient } from '../database/tenant-scope.extension';
import {
  EMAIL_EVENT_TO_TEMPLATE,
  type TransactionalEmailEvent,
  type TransactionalEmailMessage,
} from './domain/email-template';
import { TransactionalEmailService } from './transactional-email.service';

type MailSettings = ConfigType<typeof mailConfig>;

interface Recipient {
  readonly email: string;
  readonly firstName: string;
}

/**
 * Typed business-event → email mapping. It resolves account data server-side,
 * constructs trusted application URLs, then places only the rendered contract
 * on BullMQ. A queue outage is logged and never rolls back the business action.
 */
@Injectable()
export class EmailEventPublisher {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA)
    private readonly prisma: TenantScopedPrismaClient,
    @Inject(mailConfig.KEY) private readonly settings: MailSettings,
    private readonly emails: TransactionalEmailService,
    private readonly logger: PinoLogger,
  ) {}

  async publish(event: TransactionalEmailEvent): Promise<void> {
    // The event carries the business occurrence, including any single-use
    // token. Hashing it produces a stable opaque queue identity: re-publishing
    // that exact occurrence cannot enqueue a second job, while neither Redis
    // nor logs receive the sensitive token itself.
    const eventId = deriveEmailEventId(event);
    try {
      const recipient = await this.findRecipient(event.userId);
      if (recipient === null) {
        throw new Error('Email recipient account was not found.');
      }

      const message = await this.mapEvent(event, recipient, eventId);
      const jobId = await this.emails.enqueue(message);

      this.logger.info(
        {
          category: 'QUEUE',
          eventCode: 'EMAIL_QUEUED',
          emailType: EMAIL_EVENT_TO_TEMPLATE[event.type],
          deliveryStatus: 'QUEUED',
          eventId,
          jobId,
        },
        'Transactional email queued',
      );
    } catch (error: unknown) {
      // Deliberately no user email, token or action URL in this log payload.
      this.logger.error(
        {
          category: 'QUEUE',
          eventCode: 'EMAIL_ENQUEUE_FAILED',
          emailType: EMAIL_EVENT_TO_TEMPLATE[event.type],
          deliveryStatus: 'ENQUEUE_FAILED',
          eventId,
          err: error,
        },
        'Transactional email could not be queued',
      );
    }
  }

  private async findRecipient(userId: string): Promise<Recipient | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { primaryEmail: true, firstName: true },
    });

    return user === null
      ? null
      : {
          email: user.primaryEmail,
          firstName: user.firstName.trim() || 'à vous',
        };
  }

  private async mapEvent(
    event: TransactionalEmailEvent,
    recipient: Recipient,
    eventId: string,
  ): Promise<TransactionalEmailMessage> {
    const common = {
      firstName: recipient.firstName,
      supportUrl: this.url('/support'),
    };

    switch (event.type) {
      case 'USER_CREATED':
        return {
          templateId: 'account-created',
          to: recipient.email,
          eventId,
          payload: { ...common, loginUrl: this.url('/login') },
        };
      case 'EMAIL_VERIFICATION_REQUESTED':
        return {
          templateId: 'verify-email',
          to: recipient.email,
          eventId,
          payload: {
            ...common,
            email: recipient.email,
            verificationUrl: this.sensitiveUrl(
              '/verify-email',
              event.verificationToken,
            ),
            expiresIn: formatDuration(event.expiresInSeconds),
          },
        };
      case 'PASSWORD_RESET_REQUESTED':
        return {
          templateId: 'password-reset',
          to: recipient.email,
          eventId,
          payload: {
            ...common,
            resetPasswordUrl: this.sensitiveUrl(
              '/reset-password',
              event.resetToken,
            ),
            expiresIn: formatDuration(event.expiresInSeconds),
          },
        };
      case 'PASSWORD_CHANGED':
        return {
          templateId: 'password-changed',
          to: recipient.email,
          eventId,
          payload: {
            ...common,
            changedAt: formatDate(event.occurredAt),
            device: describeDevice(event.userAgent),
            location: approximateLocation(),
            maskedIp: maskIpAddress(event.ipAddress),
            securityUrl: this.url('/account/security'),
          },
        };
      case 'MFA_ENABLED':
        return {
          templateId: 'mfa-enabled',
          to: recipient.email,
          eventId,
          payload: {
            ...common,
            enabledAt: formatDate(event.occurredAt),
            securitySettingsUrl: this.url('/account/security'),
          },
        };
      case 'MFA_DISABLED':
        return {
          templateId: 'mfa-disabled',
          to: recipient.email,
          eventId,
          payload: {
            ...common,
            disabledAt: formatDate(event.occurredAt),
            securityUrl: this.url('/account/security'),
            mfaSetupUrl: this.url('/account/security#mfa'),
          },
        };
      case 'SUSPICIOUS_LOGIN_DETECTED':
        return {
          templateId: 'suspicious-login',
          to: recipient.email,
          eventId,
          payload: {
            ...common,
            loginAt: formatDate(event.occurredAt),
            device: describeDevice(event.userAgent),
            browser: describeBrowser(event.userAgent),
            location: event.location?.trim() || approximateLocation(),
            maskedIp: maskIpAddress(event.ipAddress),
            securityIncidentUrl: this.url('/account/security?incident=login'),
          },
        };
      case 'SESSION_REVOKED': {
        const session = await this.prisma.userSession.findFirst({
          where: { id: event.sessionId, userId: event.userId },
          select: {
            deviceName: true,
            userAgent: true,
            lastSeenAt: true,
          },
        });
        return {
          templateId: 'session-revoked',
          to: recipient.email,
          eventId,
          payload: {
            ...common,
            device:
              session?.deviceName?.trim() ||
              describeDevice(session?.userAgent ?? null),
            lastActivityAt: formatDate(session?.lastSeenAt ?? event.occurredAt),
            location: approximateLocation(),
            securityUrl: this.url('/account/security'),
          },
        };
      }
    }
  }

  private url(path: string): string {
    return new URL(path, this.settings.webBaseUrl).toString();
  }

  private sensitiveUrl(path: string, token: string): string {
    const url = new URL(path, this.settings.webBaseUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }
}

const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'UTC',
});

export const formatDate = (date: Date): string =>
  `${dateFormatter.format(date)} UTC`;

export function formatDuration(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} jour(s)`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} heure(s)`;
  return `${Math.max(1, Math.round(seconds / 60))} minute(s)`;
}

export function maskIpAddress(ipAddress?: string | null): string {
  if (
    ipAddress === undefined ||
    ipAddress === null ||
    ipAddress.trim() === ''
  ) {
    return 'Non disponible';
  }

  const value = ipAddress.trim();
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (ipv4 !== null) {
    return `${ipv4[1]}.***.***.${ipv4[4]}`;
  }

  if (value.includes(':')) {
    const segments = value.split(':').filter(Boolean);
    return `${segments.slice(0, 2).join(':')}:****:****:${segments.at(-1) ?? '****'}`;
  }

  return 'Masquée';
}

export function describeBrowser(userAgent?: string | null): string {
  const value = userAgent ?? '';
  const candidates: ReadonlyArray<[RegExp, string]> = [
    [/Edg\/([\d.]+)/, 'Microsoft Edge'],
    [/Chrome\/([\d.]+)/, 'Chrome'],
    [/Firefox\/([\d.]+)/, 'Firefox'],
    [/Version\/([\d.]+).*Safari/, 'Safari'],
  ];
  for (const [pattern, name] of candidates) {
    const match = pattern.exec(value);
    if (match !== null) return `${name} ${match[1] ?? ''}`.trim();
  }
  return 'Navigateur non identifié';
}

export function describeDevice(userAgent?: string | null): string {
  const value = userAgent ?? '';
  const platform = /Windows/i.test(value)
    ? 'Windows'
    : /Android/i.test(value)
      ? 'Android'
      : /iPhone|iPad/i.test(value)
        ? 'iOS'
        : /Mac OS/i.test(value)
          ? 'macOS'
          : /Linux/i.test(value)
            ? 'Linux'
            : 'appareil inconnu';
  return `${describeBrowser(value)} sur ${platform}`.slice(0, 220);
}

const approximateLocation = (): string =>
  'Localisation approximative indisponible';

export function deriveEmailEventId(event: TransactionalEmailEvent): string {
  return `eme_${createHash('sha256')
    .update(JSON.stringify(event))
    .digest('hex')}`;
}
