import { registerAs } from '@nestjs/config';

import type { Env } from './env.schema';

/**
 * Authentication parameters.
 *
 * These are configurable but are **not** free-tuning knobs: changing them
 * without reading ADR-0007 (Argon2id) and ADR-0009 (lifetimes) changes the
 * security posture. The cross rules refuse the values that would weaken it.
 */
export const authenticationConfig = registerAs('authentication', () => {
  const env = process.env as unknown as Env;

  return {
    argon2: {
      memoryCost: env.ARGON2_MEMORY_COST,
      timeCost: env.ARGON2_TIME_COST,
      parallelism: env.ARGON2_PARALLELISM,
      hashLength: env.ARGON2_HASH_LENGTH,
      // Argon2's native `secret` option, not a second hashing layer. Held
      // outside PostgreSQL so a database dump alone cannot be cracked offline.
      // Losing it makes every password unverifiable - back it up separately.
      pepper: env.PASSWORD_PEPPER,
    },

    password: {
      minLength: env.PASSWORD_MIN_LENGTH,
      maxLength: env.PASSWORD_MAX_LENGTH,
    },

    accessToken: {
      privateKey: env.ACCESS_TOKEN_PRIVATE_KEY,
      publicKey: env.ACCESS_TOKEN_PUBLIC_KEY,
      keyId: env.ACCESS_TOKEN_KEY_ID,
      // Accepted for verification during a key rotation overlap window, never
      // for signing (ADR-0005).
      previousPublicKey: env.ACCESS_TOKEN_PREVIOUS_PUBLIC_KEY,
      previousKeyId: env.ACCESS_TOKEN_PREVIOUS_KEY_ID,
      issuer: env.ACCESS_TOKEN_ISSUER,
      audienceWeb: env.ACCESS_TOKEN_AUDIENCE_WEB,
      audienceScanner: env.ACCESS_TOKEN_AUDIENCE_SCANNER,
      clockToleranceSeconds: env.JWT_CLOCK_TOLERANCE_SECONDS,
    },

    // Differentiated by client type and privilege: a scanner must survive a
    // multi-day offline event, an admin browser must not (ADR-0009).
    lifetimes: {
      accessToken: {
        webAdmin: env.ACCESS_TOKEN_TTL_WEB_ADMIN,
        webSuperAdmin: env.ACCESS_TOKEN_TTL_WEB_SUPER_ADMIN,
        scanner: env.ACCESS_TOKEN_TTL_SCANNER,
      },
      refreshToken: {
        webAdmin: env.REFRESH_TOKEN_TTL_WEB_ADMIN,
        webSuperAdmin: env.REFRESH_TOKEN_TTL_WEB_SUPER_ADMIN,
        scanner: env.REFRESH_TOKEN_TTL_SCANNER,
      },
      sessionIdle: {
        webAdmin: env.SESSION_IDLE_TTL_WEB_ADMIN,
        webSuperAdmin: env.SESSION_IDLE_TTL_WEB_SUPER_ADMIN,
        scanner: env.SESSION_IDLE_TTL_SCANNER,
      },
      // Never extended by a rotation, unlike the idle deadline.
      sessionAbsolute: {
        webAdmin: env.SESSION_ABSOLUTE_TTL_WEB_ADMIN,
        webSuperAdmin: env.SESSION_ABSOLUTE_TTL_WEB_SUPER_ADMIN,
        scanner: env.SESSION_ABSOLUTE_TTL_SCANNER,
      },
      passwordReset: env.PASSWORD_RESET_TTL,
      emailVerification: env.EMAIL_VERIFICATION_TTL,
      invitation: env.INVITATION_TTL,
      mfaChallenge: env.MFA_CHALLENGE_TTL,
      reauthentication: env.REAUTHENTICATION_TTL,
    },

    refreshToken: {
      hmacSecret: env.REFRESH_TOKEN_HMAC_SECRET,
    },

    mfa: {
      encryptionKey: env.MFA_ENCRYPTION_KEY,
      challengeMaxAttempts: env.MFA_CHALLENGE_MAX_ATTEMPTS,
      // SHA-1 is RFC 6238 and what authenticator apps expect; the security
      // rests on secret entropy and the short window (RA-5).
      totpDigits: env.TOTP_DIGITS,
      totpPeriodSeconds: env.TOTP_PERIOD_SECONDS,
      totpDriftWindows: env.TOTP_DRIFT_WINDOWS,
      recoveryCodeCount: env.RECOVERY_CODE_COUNT,
    },

    tokens: {
      invitationSecret: env.INVITATION_TOKEN_SECRET,
      passwordResetSecret: env.PASSWORD_RESET_TOKEN_SECRET,
    },

    qr: {
      signingPrivateKey: env.QR_SIGNING_PRIVATE_KEY,
      signingPublicKey: env.QR_SIGNING_PUBLIC_KEY,
      signingKeyId: env.QR_SIGNING_KEY_ID,
      replayWindowSeconds: env.QR_REPLAY_WINDOW_SECONDS,
    },

    bootstrapSuperAdminEmail: env.BOOTSTRAP_SUPER_ADMIN_EMAIL,
  };
});
