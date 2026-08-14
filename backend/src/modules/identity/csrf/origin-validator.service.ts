import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request } from 'express';

import { applicationConfig } from '../../../config/application.config';

/**
 * §3.5 — scheme, host and port, by strict equality against the configured
 * list.
 *
 * `origin.includes('eventini.com')` is explicitly forbidden by the
 * specification: `https://eventini.com.attacker.tld` would pass it. The same
 * list feeds CORS, so a browser refusal and a server refusal can never
 * disagree about which origins are ours.
 */
@Injectable()
export class OriginValidatorService {
  constructor(
    @Inject(applicationConfig.KEY)
    private readonly application: ConfigType<typeof applicationConfig>,
  ) {}

  isAllowed(request: Request): boolean {
    const origin = header(request, 'origin');

    if (origin !== undefined) {
      return this.allows(origin);
    }

    // Referer is a controlled fallback and only when `Origin` is absent: it
    // carries a full URL, so only its origin component is ever compared.
    const referer = header(request, 'referer');
    const derived = referer === undefined ? null : originOf(referer);

    return derived !== null && this.allows(derived);
  }

  private allows(origin: string): boolean {
    return this.application.corsAllowedOrigins.includes(origin);
  }
}

function header(request: Request, name: string): string | undefined {
  const raw = request.headers[name];

  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
