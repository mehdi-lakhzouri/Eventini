import { generateKeyPairSync, randomBytes } from 'node:crypto';

/**
 * Builds a raw environment that passes every check.
 *
 * Uses real generated Ed25519 key pairs rather than hard-coded strings, so the
 * key-pair rule is exercised against genuine cryptographic material — a
 * hard-coded pair could drift into a matching-by-accident state and quietly
 * stop testing anything.
 */

function generateSecret(): string {
  return randomBytes(32).toString('base64');
}

function generateKeyPair(): { privateKey: string; publicKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');

  return {
    privateKey: Buffer.from(
      privateKey.export({ type: 'pkcs8', format: 'pem' }),
    ).toString('base64'),
    publicKey: Buffer.from(
      publicKey.export({ type: 'spki', format: 'pem' }),
    ).toString('base64'),
  };
}

export function buildValidEnv(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const accessTokenKeys = generateKeyPair();
  const qrKeys = generateKeyPair();

  return {
    NODE_ENV: 'test',
    PORT: '3001',
    API_BASE_URL: 'http://localhost:3001',
    WEB_BASE_URL: 'http://localhost:3000',
    TRUSTED_PROXY_HOPS: '1',

    DATABASE_URL:
      'postgresql://user:pass@localhost:5433/eventini?schema=public',
    REDIS_URL: 'redis://:pass@localhost:6380/0',

    ACCESS_TOKEN_PRIVATE_KEY: accessTokenKeys.privateKey,
    ACCESS_TOKEN_PUBLIC_KEY: accessTokenKeys.publicKey,
    ACCESS_TOKEN_KEY_ID: 'ak_test',
    ACCESS_TOKEN_ISSUER: 'http://localhost:3001',
    QR_SIGNING_PRIVATE_KEY: qrKeys.privateKey,
    QR_SIGNING_PUBLIC_KEY: qrKeys.publicKey,
    QR_SIGNING_KEY_ID: 'qr_test',

    // Independent by construction: reuse is exactly what rule 8 refuses.
    REFRESH_TOKEN_HMAC_SECRET: generateSecret(),
    CSRF_SECRET: generateSecret(),
    MFA_ENCRYPTION_KEY: generateSecret(),
    INVITATION_TOKEN_SECRET: generateSecret(),
    PASSWORD_RESET_TOKEN_SECRET: generateSecret(),
    PASSWORD_PEPPER: generateSecret(),
    COOKIE_SECRET: generateSecret(),

    CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
    /*
      🔴 `true`, parce que les noms de cookies par défaut portent les préfixes
      `__Host-` / `__Secure-`. La fixture encodait `false`, c'est-à-dire
      exactement la combinaison que `cookie-prefix.rule.ts` refuse désormais —
      et que `.env.example` livrait, au prix de connexions locales
      systématiquement refusées en `AUTH_CSRF_INVALID`.

      Un cas qui a besoin de `COOKIE_SECURE=false` doit désormais surcharger
      aussi les noms de cookies, ce qui est le bon couplage : les deux vont
      ensemble ou ne vont pas.
    */
    COOKIE_SECURE: 'true',

    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    SMTP_USER: 'eventini',
    SMTP_PASSWORD: 'eventini',
    MAIL_FROM_ADDRESS: 'no-reply@eventini.local',

    ...overrides,
  };
}
