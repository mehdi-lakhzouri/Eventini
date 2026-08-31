import { detail, notice } from './components';
import type { EmailTemplateDefinition } from './template.types';

export const suspiciousLoginTemplate: EmailTemplateDefinition<'suspicious-login'> =
  {
    id: 'suspicious-login',
    subject: 'Alerte de sécurité — connexion inhabituelle détectée',
    build: (payload) => ({
      preheader: 'Vérifiez cette activité si vous ne la reconnaissez pas.',
      title: 'Nouvelle connexion détectée',
      icon: 'shield-alert',
      iconTone: 'danger',
      paragraphs: [
        `Bonjour ${payload.firstName}, une connexion à votre compte Eventini a été détectée depuis un appareil ou un environnement inhabituel.`,
      ],
      details: [
        detail('◫', 'Date', payload.loginAt),
        detail('▯', 'Appareil', payload.device),
        detail('◎', 'Navigateur', payload.browser),
        detail('⌖', 'Localisation approximative', payload.location),
        detail('⌁', 'Adresse IP', payload.maskedIp),
      ],
      notices: [
        notice('info', 'ⓘ', 'Vous pouvez ignorer cet email.', 'C’était vous ?'),
        notice(
          'danger',
          '⚠',
          'Révoquez immédiatement vos sessions actives et modifiez votre mot de passe.',
          'Vous ne reconnaissez pas cette connexion ?',
        ),
      ],
      primaryButton: {
        label: 'Sécuriser mon compte',
        url: payload.securityIncidentUrl,
      },
      supportUrl: payload.supportUrl,
    }),
  };
