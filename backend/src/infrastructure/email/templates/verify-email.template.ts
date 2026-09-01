import type { EmailTemplateDefinition } from './template.types';
import { notice, securityNote } from './components';

export const verifyEmailTemplate: EmailTemplateDefinition<'verify-email'> = {
  id: 'verify-email',
  subject: 'Vérifiez votre adresse e-mail',
  build: (payload) => ({
    preheader: 'Confirmez votre adresse pour sécuriser votre compte Eventini.',
    title: 'Vérifiez votre adresse e-mail',
    icon: 'mail-check',
    iconTone: 'info',
    paragraphs: [
      `Bonjour ${payload.firstName}, confirmez que ${payload.email} vous appartient afin de finaliser la configuration de votre compte Eventini.`,
    ],
    primaryButton: {
      label: 'Vérifier mon adresse',
      url: payload.verificationUrl,
    },
    notices: [notice('info', 'ⓘ', `Ce lien expire dans ${payload.expiresIn}.`)],
    fallback: {
      introduction:
        'Si le bouton ne fonctionne pas, copiez le lien suivant dans votre navigateur :',
      url: payload.verificationUrl,
    },
    securityNote: securityNote(
      "Si vous n'avez pas créé de compte Eventini, vous pouvez ignorer cet email.",
    ),
    supportUrl: payload.supportUrl,
  }),
};
