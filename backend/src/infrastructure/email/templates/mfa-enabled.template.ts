import type { EmailTemplateDefinition } from './template.types';
import { notice, securityNote } from './components';

export const mfaEnabledTemplate: EmailTemplateDefinition<'mfa-enabled'> = {
  id: 'mfa-enabled',
  subject: "L'authentification multifacteur est activée",
  build: (payload) => ({
    preheader: 'Votre compte bénéficie maintenant d’une protection renforcée.',
    title: 'MFA activée avec succès',
    icon: 'shield-check',
    iconTone: 'success',
    paragraphs: [
      `Bonjour ${payload.firstName}, l’authentification multifacteur a été activée sur votre compte Eventini le ${payload.enabledAt}.`,
      'Lors de vos prochaines connexions, un second facteur d’authentification pourra être requis en complément de votre mot de passe.',
    ],
    notices: [
      notice(
        'success',
        'ⓘ',
        'Votre compte bénéficie maintenant d’un niveau de protection supplémentaire.',
      ),
    ],
    primaryButton: {
      label: 'Consulter mes paramètres de sécurité',
      url: payload.securitySettingsUrl,
    },
    securityNote: securityNote(
      'Contactez immédiatement votre administrateur et sécurisez votre compte.',
      'info',
      'Vous n’avez pas activé cette fonctionnalité ?',
    ),
    supportUrl: payload.supportUrl,
  }),
};
