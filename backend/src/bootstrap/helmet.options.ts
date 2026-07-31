import type { HelmetOptions } from 'helmet';

/**
 * Security headers, with explicit directives rather than defaults
 * (AUTHENTICATION_AUTHORIZATION.md §4 — Document B §43 listed the 7 headers
 * without ever giving a directive).
 *
 * `frame-ancestors 'none'` AND `X-Frame-Options: DENY` together: the second
 * covers browsers that ignore the first.
 *
 * No nonce on `script-src`: this backend renders no HTML with inline scripts
 * of its own. The only HTML surface it can ever serve is the Swagger UI
 * (SWAGGER_ENABLED, never in production), whose bundled UI loads its scripts
 * from 'self' rather than inline. A per-request nonce is the frontend's
 * concern — Next.js owns the pages that actually need one.
 *
 * `Permissions-Policy` is NOT set here: verified against Helmet 8.3's actual
 * type (`node_modules/helmet/index.d.cts`) and runtime
 * (`getMiddlewareFunctionsFromOptions` in `index.cjs`) that no such option
 * exists — support was dropped from Helmet core years ago. It is applied by
 * a small dedicated middleware instead; see `permissions-policy.middleware.ts`.
 */
export function buildHelmetOptions(): HelmetOptions {
  return {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Tailwind and component libraries inject inline styles; a nonce here
        // would break style hydration for no real XSS benefit — the CSS
        // injection surface is far narrower than script injection, which
        // stays strict at 'self'.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    hsts: {
      maxAge: 31_536_000,
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xFrameOptions: { action: 'deny' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    // true is Helmet's "protection active" value: the middleware then
    // REMOVES X-Powered-By. Reading the option name backwards here would
    // have shipped the exact header this rule exists to strip.
    xPoweredBy: true,
  };
}
