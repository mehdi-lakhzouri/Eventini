import { notice } from './components';
import type { EmailTemplateDefinition } from './template.types';

export const mfaDisabledTemplate: EmailTemplateDefinition<'mfa-disabled'> = {
  id: 'mfa-disabled',
  subject: "L'authentification multifacteur a été désactivée",
  build: (payload) => ({
    preheader: 'La protection MFA de votre compte Eventini a été désactivée.',
    title: 'MFA désactivée',
    icon: 'shield-alert',
    iconTone: 'danger',
    paragraphs: [
      `Bonjour ${payload.firstName}, l’authentification multifacteur de votre compte Eventini a été désactivée le ${payload.disabledAt}.`,
      'Votre compte n’utilise désormais plus cette couche de protection supplémentaire.',
    ],
    primaryButton: {
      label: 'Sécuriser mon compte',
      url: payload.securityUrl,
    },
    secondaryButton: {
      label: 'Réactiver la MFA',
      url: payload.mfaSetupUrl,
    },
    notices: [
      notice(
        'danger',
        '⚠',
        'Considérez votre compte comme potentiellement compromis.',
        'Vous n’avez pas effectué cette action ?',
      ),
      notice(
        'info',
        'ⓘ',
        'Si vous pensez qu’il s’agit d’une erreur, contactez le support immédiatement.',
      ),
    ],
    supportUrl: payload.supportUrl,
  }),
};
