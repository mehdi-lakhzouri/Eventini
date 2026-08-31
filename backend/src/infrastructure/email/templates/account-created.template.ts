import type { EmailTemplateDefinition } from './template.types';
import { notice, securityNote } from './components';

export const accountCreatedTemplate: EmailTemplateDefinition<'account-created'> =
  {
    id: 'account-created',
    subject: 'Bienvenue sur Eventini',
    build: (payload) => ({
      preheader: 'Votre compte Eventini est prêt.',
      title: 'Bienvenue sur Eventini',
      icon: 'user-check',
      iconTone: 'info',
      paragraphs: [
        `Bonjour ${payload.firstName}, votre compte Eventini a été créé avec succès.`,
        'Vous pouvez maintenant accéder à votre espace et commencer à gérer vos événements, participants et sessions.',
      ],
      primaryButton: { label: 'Accéder à Eventini', url: payload.loginUrl },
      notices: [notice('info', 'ⓘ', 'Votre espace est prêt à être utilisé.')],
      securityNote: securityNote(
        "Si vous n'êtes pas à l'origine de cette inscription, contactez immédiatement votre administrateur ou le support Eventini.",
      ),
      supportUrl: payload.supportUrl,
    }),
  };
