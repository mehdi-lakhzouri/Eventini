import type { Request } from 'express';

import { stripQueryString } from '../api/strip-query-string';

/**
 * The route as the router knows it — `/api/v1/events/:eventId/check-ins`.
 *
 * Express attaches the matched layer's pattern to `req.route` before the
 * handler runs, and Nest registers its routes with the global prefix already
 * applied, so this is the template §3 asks for rather than the concrete URI.
 *
 * The fallback is the concrete path, and it is a fallback rather than the
 * default on purpose: `req.route` is absent only when no handler matched, in
 * which case there is no idempotent route to speak of. Falling back to the
 * URI is strictly narrower — two requests to different ids would stop sharing
 * a key namespace — which fails towards executing twice rather than towards
 * replaying somebody else's answer.
 */
export function routeTemplateOf(request: Request): string {
  const matched = (request as { route?: { path?: unknown } }).route?.path;

  return typeof matched === 'string' && matched.length > 0
    ? matched
    : stripQueryString(request.originalUrl ?? request.url);
}
