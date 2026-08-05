import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { csrfConfig } from '../../../config/csrf.config';
import { csrfTokenMatches, issueCsrfToken } from './domain/csrf-token';

/**
 * The keyed half of the subsystem, and the only holder of `CSRF_SECRET`.
 *
 * Kept apart from `CsrfService` so the cookie mechanics and the cryptography
 * can be reasoned about — and tested — one at a time.
 */
@Injectable()
export class CsrfTokenService {
  constructor(
    @Inject(csrfConfig.KEY)
    private readonly csrf: ConfigType<typeof csrfConfig>,
  ) {}

  issue(binding: string): string {
    return issueCsrfToken(this.csrf.secret, binding);
  }

  matches(binding: string, token: string): boolean {
    return csrfTokenMatches(this.csrf.secret, binding, token);
  }
}
