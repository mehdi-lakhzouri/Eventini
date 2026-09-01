import {
  EMAIL_EVENT_TO_TEMPLATE,
  EMAIL_TEMPLATE_IDS,
  type TransactionalEmailMessage,
} from './domain/email-template';
import { EmailRenderer } from './email-renderer';
import { EMAIL_PREVIEW_MESSAGES } from './testing/email.fixtures';

const expected: Record<
  TransactionalEmailMessage['templateId'],
  { title: string; cta: string; securityCopy: string }
> = {
  'account-created': {
    title: 'Bienvenue sur Eventini',
    cta: 'Accéder à Eventini',
    securityCopy: "Si vous n'êtes pas à l'origine",
  },
  'verify-email': {
    title: 'Vérifiez votre adresse e-mail',
    cta: 'Vérifier mon adresse',
    securityCopy: "Si vous n'avez pas créé de compte",
  },
  'password-reset': {
    title: 'Réinitialisation du mot de passe',
    cta: 'Réinitialiser mon mot de passe',
    securityCopy: 'mot de passe actuel reste inchangé',
  },
  'password-changed': {
    title: 'Mot de passe modifié',
    cta: 'Sécuriser mon compte',
    securityCopy: 'Sécurisez immédiatement votre compte',
  },
  'mfa-enabled': {
    title: 'MFA activée avec succès',
    cta: 'Consulter mes paramètres de sécurité',
    securityCopy: 'protection supplémentaire',
  },
  'mfa-disabled': {
    title: 'MFA désactivée',
    cta: 'Sécuriser mon compte',
    securityCopy: 'potentiellement compromis',
  },
  'suspicious-login': {
    title: 'Nouvelle connexion détectée',
    cta: 'Sécuriser mon compte',
    securityCopy: 'Révoquez immédiatement vos sessions actives',
  },
  'session-revoked': {
    title: 'Session révoquée',
    cta: 'Vérifier la sécurité de mon compte',
    securityCopy: 'Si vous ne reconnaissez pas cette activité',
  },
};

describe('transactional email renderer', () => {
  const renderer = new EmailRenderer();

  it.each(EMAIL_PREVIEW_MESSAGES)(
    'renders $templateId as HTML and plain text',
    async (message) => {
      const output = await renderer.render(message);
      const copy = expected[message.templateId];

      expect(output.html).toContain('<!doctype html>');
      expect(output.html).toContain(copy.title);
      expect(output.html).toContain(copy.cta);
      expect(output.html).toContain('cid:eventini-logo@eventini');
      expect(output.text).toContain(copy.title);
      expect(output.text).toContain(copy.cta);
      expect(output.text).toContain(copy.securityCopy);
      expect(output.attachments).toHaveLength(2);
    },
  );

  it('escapes malicious user-controlled values instead of interpreting HTML', async () => {
    const message = {
      templateId: 'password-changed',
      to: 'safe@example.com',
      payload: {
        ...EMAIL_PREVIEW_MESSAGES[3]?.payload,
        firstName: '<script>alert(1)</script>',
        device: '<img src=x onerror=alert(1)>',
      },
    };

    const output = await renderer.render(message);
    expect(output.html).not.toContain('<script>alert(1)</script>');
    expect(output.html).not.toContain('<img src=x onerror=alert(1)>');
    expect(output.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(output.html).toContain(
      '&lt;img src&#x3D;x onerror&#x3D;alert(1)&gt;',
    );
  });

  it('strips unknown sensitive fields before rendering', async () => {
    const fixture = EMAIL_PREVIEW_MESSAGES[0];
    if (fixture?.templateId !== 'account-created') throw new Error('fixture');
    const output = await renderer.render({
      ...fixture,
      payload: {
        ...fixture.payload,
        password: 'do-not-render-password',
        passwordHash: 'do-not-render-hash',
        refreshToken: 'do-not-render-refresh',
        totpSecret: 'do-not-render-totp',
        recoveryCodes: ['do-not-render-recovery'],
      },
    });

    for (const secret of [
      'do-not-render-password',
      'do-not-render-hash',
      'do-not-render-refresh',
      'do-not-render-totp',
      'do-not-render-recovery',
    ]) {
      expect(output.html).not.toContain(secret);
      expect(output.text).not.toContain(secret);
    }
  });

  it('rejects a missing or non-HTTP action URL', async () => {
    await expect(
      renderer.render({
        templateId: 'account-created',
        to: 'safe@example.com',
        payload: {
          firstName: 'Mehdi',
          loginUrl: 'javascript:alert(1)',
          supportUrl: 'https://app.eventini.test/support',
        },
      }),
    ).rejects.toThrow('Invalid transactional email message');
  });

  it('embeds assets only for local previews', async () => {
    const output = await renderer.render(EMAIL_PREVIEW_MESSAGES[0], {
      embedAssets: true,
    });
    expect(output.html).toContain('src="data:image/png;base64,');
    expect(output.attachments).toEqual([]);
  });

  it('maps every business event to one of the eight templates', () => {
    expect(new Set(Object.values(EMAIL_EVENT_TO_TEMPLATE))).toEqual(
      new Set(EMAIL_TEMPLATE_IDS),
    );
  });
});
