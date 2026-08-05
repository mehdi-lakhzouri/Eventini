import { ScureBase32Plugin } from 'otplib';

import {
  currentTotpCode,
  generateTotpSecret,
  totpUri,
  verifyTotp,
  type TotpSettings,
} from './totp';

/**
 * RFC 6238 Appendix B's seed is the ASCII string "12345678901234567890";
 * base32 is only how a TOTP secret is transported.
 *
 * Derived rather than pasted, for two reasons: it shows where the value comes
 * from instead of presenting an opaque blob, and a 32-character high-entropy
 * literal in a source file is indistinguishable from a real leaked secret to
 * any scanner worth running.
 */
const RFC_SECRET = new ScureBase32Plugin().encode(
  new TextEncoder().encode('12345678901234567890'),
);

const SETTINGS: TotpSettings = {
  digits: 6,
  periodSeconds: 30,
  driftWindows: 1,
};

describe('totp', () => {
  describe('interoperability', () => {
    /**
     * RFC 6238 Appendix B, the published vectors for the ASCII secret
     * "12345678901234567890" in base32.
     *
     * These exist because three separate bugs in this file all produced
     * *self-consistent* results — enrolment and verification agreed with each
     * other while agreeing with no real authenticator app. Only an external
     * reference catches that class of mistake, so it is pinned here.
     */
    const RFC_SETTINGS: TotpSettings = {
      digits: 8,
      periodSeconds: 30,
      driftWindows: 0,
    };

    it.each([
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ])(
      'matches the RFC 6238 vector at T=%i',
      async (epochSeconds, expected) => {
        jest.useFakeTimers().setSystemTime(epochSeconds * 1000);

        await expect(currentTotpCode(RFC_SECRET, RFC_SETTINGS)).resolves.toBe(
          expected,
        );

        jest.useRealTimers();
      },
    );
  });

  describe('verifyTotp', () => {
    it('accepts the code an authenticator app would show right now', async () => {
      const secret = generateTotpSecret();
      const code = await currentTotpCode(secret, SETTINGS);

      await expect(verifyTotp(secret, code, SETTINGS)).resolves.toBe(true);
    });

    it('accepts a code from the previous window, per the ±1 drift rule', async () => {
      const secret = generateTotpSecret();
      jest.useFakeTimers().setSystemTime(1_700_000_000_000);
      const code = await currentTotpCode(secret, SETTINGS);

      // One full period later the app-side code has rolled over, but a user
      // who typed slowly must still get in.
      jest.setSystemTime(1_700_000_030_000);
      await expect(verifyTotp(secret, code, SETTINGS)).resolves.toBe(true);

      jest.useRealTimers();
    });

    it('rejects a code three windows old, so tolerance is bounded', async () => {
      const secret = generateTotpSecret();
      jest.useFakeTimers().setSystemTime(1_700_000_000_000);
      const code = await currentTotpCode(secret, SETTINGS);

      jest.setSystemTime(1_700_000_090_000);
      await expect(verifyTotp(secret, code, SETTINGS)).resolves.toBe(false);

      jest.useRealTimers();
    });

    it('rejects another secret’s code', async () => {
      const code = await currentTotpCode(generateTotpSecret(), SETTINGS);

      await expect(
        verifyTotp(generateTotpSecret(), code, SETTINGS),
      ).resolves.toBe(false);
    });

    it.each([
      ['non-numeric', 'abcdef'],
      ['too short', '12345'],
      ['too long', '1234567'],
      ['empty', ''],
      ['padded', ' 123456 '],
    ])('rejects a %s token without consulting the secret', async (_, token) => {
      await expect(
        verifyTotp(generateTotpSecret(), token, SETTINGS),
      ).resolves.toBe(false);
    });
  });

  describe('generateTotpSecret', () => {
    it('produces 160 bits of base32, per §4.7', () => {
      // 20 bytes -> 32 base32 characters.
      expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
    });

    it('never repeats', () => {
      const secrets = new Set(
        Array.from({ length: 50 }, () => generateTotpSecret()),
      );

      expect(secrets.size).toBe(50);
    });
  });

  describe('totpUri', () => {
    const uriFor = (settings: TotpSettings) =>
      new URL(
        totpUri({
          secret: RFC_SECRET,
          accountName: 'ada@example.com',
          issuer: 'Eventini',
          settings,
        }),
      );

    it('identifies the account and the issuer', () => {
      const uri = uriFor(SETTINGS);

      expect(uri.protocol).toBe('otpauth:');
      expect(uri.host).toBe('totp');
      expect(decodeURIComponent(uri.pathname)).toBe(
        '/Eventini:ada@example.com',
      );
      expect(uri.searchParams.get('issuer')).toBe('Eventini');
      expect(uri.searchParams.get('secret')).toBe(RFC_SECRET);
    });

    /**
     * The Key Uri Format defines SHA1 / 6 digits / 30 s as the defaults, so
     * our settings are carried by omission. That is deliberate — some
     * authenticator apps mishandle explicit parameters — but it only holds
     * while the settings *are* the defaults, which is what this asserts.
     */
    it('leaves the default parameters implicit', () => {
      const uri = uriFor(SETTINGS);

      expect(uri.searchParams.get('algorithm')).toBeNull();
      expect(uri.searchParams.get('digits')).toBeNull();
      expect(uri.searchParams.get('period')).toBeNull();
    });

    it('states any parameter that departs from the defaults', () => {
      const uri = uriFor({ digits: 8, periodSeconds: 60, driftWindows: 1 });

      expect(uri.searchParams.get('digits')).toBe('8');
      expect(uri.searchParams.get('period')).toBe('60');
    });
  });
});
