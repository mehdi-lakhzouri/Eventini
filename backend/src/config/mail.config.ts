import { registerAs } from '@nestjs/config';

import { getValidatedEnv } from './validated-env';

/** Transport and brand links used by the transactional-email subsystem. */
export const mailConfig = registerAs('mail', () => {
  const env = getValidatedEnv();

  return {
    smtp: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
    },
    from: {
      address: env.MAIL_FROM_ADDRESS,
      name: env.MAIL_FROM_NAME,
    },
    replyTo: env.MAIL_REPLY_TO,
    webBaseUrl: env.WEB_BASE_URL,
  };
});
