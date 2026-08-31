import { detail, notice, securityNote } from './components';
import type { EmailTemplateDefinition } from './template.types';

export const sessionRevokedTemplate: EmailTemplateDefinition<'session-revoked'> =
  {
    id: 'session-revoked',
    subject: 'Une session Eventini a été déconnectée',
    build: (payload) => ({
      preheader: 'Une session active de votre compte a été révoquée.',
      title: 'Session révoquée',
      icon: 'monitor-x',
      iconTone: 'info',
      paragraphs: [
        `Bonjour ${payload.firstName}, une session active de votre compte Eventini a été révoquée avec succès.`,
      ],
      details: [
        detail('▣', 'Appareil', payload.device),
        detail('◷', 'Dernière activité', payload.lastActivityAt),
        detail('⌖', 'Localisation', payload.location),
      ],
      notices: [
        notice(
          'info',
          'ⓘ',
          'Si vous avez effectué cette action, aucune autre intervention n’est nécessaire.',
        ),
      ],
      securityNote: securityNote(
        'Si vous ne reconnaissez pas cette activité, nous vous recommandons de vérifier immédiatement les paramètres de sécurité de votre compte.',
      ),
      primaryButton: {
        label: 'Vérifier la sécurité de mon compte',
        url: payload.securityUrl,
      },
      supportUrl: payload.supportUrl,
    }),
  };
