import type { NextFunction, Request, Response } from 'express';

/**
 * Sets `Permissions-Policy`. Helmet 8 dropped support for this header years
 * ago — confirmed against its actual type and runtime source, not assumed —
 * so it is applied directly rather than through a Helmet option that does not
 * exist.
 *
 * `camera=(self)` is the one feature actually granted: the web scanner reads
 * its own camera to decode a QR code (AUTHENTICATION_AUTHORIZATION.md §4).
 * Everything else this API has no reason to use is denied outright.
 */
const PERMISSIONS_POLICY_VALUE =
  'camera=(self), microphone=(), geolocation=(), payment=()';

export function permissionsPolicyMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader('Permissions-Policy', PERMISSIONS_POLICY_VALUE);
  next();
}
