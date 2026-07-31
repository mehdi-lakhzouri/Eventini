import { registerAs } from '@nestjs/config';

import { getValidatedEnv } from './validated-env';

/**
 * Rate limiting and lockout (ADR-0013).
 *
 * The lockout key is ip+email, never email alone: locking on the email would
 * let an attacker lock any user out by guessing their address, turning the
 * control into the denial of service it exists to prevent.
 */
export const rateLimitConfig = registerAs('rateLimit', () => {
  const env = getValidatedEnv();

  return {
    global: {
      perIp: env.RATE_LIMIT_GLOBAL_IP,
      perUser: env.RATE_LIMIT_GLOBAL_USER,
      perOrganization: env.RATE_LIMIT_GLOBAL_ORG,
    },

    login: {
      perIpAndEmail: env.RATE_LIMIT_LOGIN_IP_EMAIL,
      windowMs: env.RATE_LIMIT_LOGIN_IP_EMAIL_WINDOW,
      perIp: env.RATE_LIMIT_LOGIN_IP,
    },

    mfaVerify: env.RATE_LIMIT_MFA_VERIFY,
    refresh: env.RATE_LIMIT_REFRESH,
    passwordResetPerEmail: env.RATE_LIMIT_PASSWORD_RESET_EMAIL,
    checkInPerDevice: env.RATE_LIMIT_CHECKIN_DEVICE,

    lockout: {
      thresholds: env.LOCKOUT_THRESHOLDS,
      durations: env.LOCKOUT_DURATIONS,
    },

    // Redis down must never open the door to brute force, but must not take the
    // whole application offline either.
    failMode: {
      authentication: env.RATE_LIMIT_FAIL_MODE_AUTH,
      other: env.RATE_LIMIT_FAIL_MODE_OTHER,
    },
  };
});
