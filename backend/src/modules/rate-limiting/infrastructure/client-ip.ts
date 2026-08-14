import type { Request } from 'express';

/**
 * The client address, taken only from what the trusted-proxy configuration
 * already vouched for.
 *
 * Infrastructure rather than domain: this translates an Express request into a
 * plain string, and needing the framework's type to compile is precisely what
 * `forbidden-imports.spec.ts` keeps out of `domain/`. The policy layer takes
 * the resulting `ip` and knows nothing about how it was obtained.
 *
 * `req.ip` is Express's answer *after* it has applied `trust proxy`, which
 * `main.ts` sets to an explicit hop count and never to `true`. Reading
 * `X-Forwarded-For` directly here would undo that: the header is client-
 * supplied, so anyone could forge a fresh address per request and walk past
 * every per-IP limit. RATE_LIMITING_AND_ABUSE_PREVENTION.md §7.6 calls this
 * the most common mistake in rate-limiter implementations, and it is only
 * avoidable by *not* looking at the header at this layer.
 */
export function clientIpOf(request: Request): string | null {
  const ip = request.ip;

  return typeof ip === 'string' && ip.trim() !== '' ? ip : null;
}
