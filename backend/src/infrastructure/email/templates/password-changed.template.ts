import type { EmailTemplateDefinition } from './template.types';
import { detail, notice, securityNote } from './components';

export const passwordChangedTemplate: EmailTemplateDefinition<'password-changed'> =
  {
    id: 'password-changed',
    subject: 'Votre mot de passe Eventini a été modifié',
    build: (payload) => ({
      preheader: 'Le mot de passe de votre compte Eventini a été modifié.',
      title: 'Mot de passe modifié',
      icon: 'shield-check',
      iconTone: 'success',
      paragraphs: [
        `Bonjour ${payload.firstName}, le mot de passe de votre compte Eventini a été modifié avec succès le ${payload.changedAt}.`,
      ],
      details: [
        detail('▣', 'Appareil', payload.device),
        detail('⌖', 'Localisation approximative', payload.location),
        detail('IP', 'Adresse IP', payload.maskedIp),
      ],
      notices: [
        notice(
          'danger',
          '!',
          'Sécurisez immédiatement votre compte et contactez votre administrateur.',
          'Vous n’êtes pas à l’origine de cette modification ?',
        ),
      ],
      primaryButton: {
        label: 'Sécuriser mon compte',
        url: payload.securityUrl,
      },
      securityNote: securityNote(
        'Si vous n’avez pas créé de compte Eventini, vous pouvez ignorer cet email.',
      ),
      supportUrl: payload.supportUrl,
    }),
  };
