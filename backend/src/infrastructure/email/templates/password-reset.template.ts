import type { EmailTemplateDefinition } from './template.types';
import { notice, securityNote } from './components';

export const passwordResetTemplate: EmailTemplateDefinition<'password-reset'> =
  {
    id: 'password-reset',
    subject: 'Réinitialisez votre mot de passe Eventini',
    build: (payload) => ({
      preheader:
        'Une demande de réinitialisation a été effectuée pour votre compte.',
      title: 'Réinitialisation du mot de passe',
      icon: 'key',
      iconTone: 'info',
      paragraphs: [
        `Bonjour ${payload.firstName}, nous avons reçu une demande de réinitialisation du mot de passe associé à votre compte Eventini.`,
        'Utilisez le bouton ci-dessous pour choisir un nouveau mot de passe.',
      ],
      primaryButton: {
        label: 'Réinitialiser mon mot de passe',
        url: payload.resetPasswordUrl,
      },
      notices: [
        notice(
          'info',
          'ⓘ',
          `Ce lien est valable pendant ${payload.expiresIn} et ne peut être utilisé qu'une seule fois.`,
        ),
      ],
      fallback: {
        introduction:
          'Si le bouton ne fonctionne pas, copiez le lien suivant dans votre navigateur :',
        url: payload.resetPasswordUrl,
      },
      securityNote: securityNote(
        'Aucune action n’est nécessaire. Votre mot de passe actuel reste inchangé.',
        'neutral',
        'Vous n’avez pas demandé cette réinitialisation ?',
      ),
      supportUrl: payload.supportUrl,
    }),
  };
