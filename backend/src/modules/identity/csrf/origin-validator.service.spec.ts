import type { ConfigType } from '@nestjs/config';
import type { Request } from 'express';

import type { applicationConfig } from '../../../config/application.config';
import { OriginValidatorService } from './origin-validator.service';

const ALLOWED = 'https://app.eventini.com';

const validator = new OriginValidatorService({
  corsAllowedOrigins: [ALLOWED],
} as unknown as ConfigType<typeof applicationConfig>);

function requestWith(headers: Record<string, string>): Request {
  return { headers } as unknown as Request;
}

describe('OriginValidatorService', () => {
  it('allows an exactly matching origin', () => {
    expect(validator.isAllowed(requestWith({ origin: ALLOWED }))).toBe(true);
  });

  it('refuses a request with neither Origin nor Referer', () => {
    expect(validator.isAllowed(requestWith({}))).toBe(false);
  });

  /**
   * §3.5 forbids substring matching by name. Each of these passes
   * `origin.includes('eventini.com')` and must still be refused.
   */
  it.each([
    ['a lookalike host', 'https://app.eventini.com.attacker.tld'],
    ['a path-suffixed origin', 'https://attacker.tld/app.eventini.com'],
    ['a different scheme', 'http://app.eventini.com'],
    ['a different port', 'https://app.eventini.com:8443'],
    ['a different subdomain', 'https://admin.eventini.com'],
    ['the null origin', 'null'],
  ])('refuses %s', (_label, origin) => {
    expect(validator.isAllowed(requestWith({ origin }))).toBe(false);
  });

  describe('Referer fallback', () => {
    it('accepts a Referer whose origin is allowed when Origin is absent', () => {
      expect(
        validator.isAllowed(
          requestWith({ referer: `${ALLOWED}/login?next=/events` }),
        ),
      ).toBe(true);
    });

    it('refuses a Referer from elsewhere', () => {
      expect(
        validator.isAllowed(requestWith({ referer: 'https://attacker.tld/x' })),
      ).toBe(false);
    });

    it('refuses an unparseable Referer', () => {
      expect(validator.isAllowed(requestWith({ referer: 'not a url' }))).toBe(
        false,
      );
    });

    /** A present Origin is the stronger signal and settles it alone. */
    it('is not consulted when Origin is present and denied', () => {
      expect(
        validator.isAllowed(
          requestWith({ origin: 'https://attacker.tld', referer: ALLOWED }),
        ),
      ).toBe(false);
    });
  });
});
