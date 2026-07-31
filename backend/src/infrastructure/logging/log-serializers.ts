/**
 * The `req` / `res` / `err` serializers — resolving C-25.
 *
 * Document D §37 promises a `log-serializers.ts` and §40 says to "add safe
 * serializers", but never specifies one. These are that specification.
 *
 * ## Why the defaults could not simply be kept
 *
 * `pino-std-serializers` (what `pino-http` uses when you supply nothing) emits
 * **every request header** and the **full URL including its query string**.
 * Run against a realistic request it produces, verbatim:
 *
 * ```json
 * { "method": "GET", "url": "/api/v1/x?token=secret",
 *   "headers": { "authorization": "Bearer abc", "cookie": "a=b" }, … }
 * ```
 *
 * which is three separate violations at once — §41 forbids logging full
 * headers, §30 requires `authorization`/`cookie` be removed, and a one-time
 * token in a query string is exactly the credential §30 exists to keep out of
 * the log store. Redaction would catch the two named headers, but not the
 * query string and not any header we have not thought of yet.
 *
 * These serializers are therefore **allowlists**: a header or field appears in
 * a log because it was named here, never because it happened to be on the
 * request. A new header added by a proxy tomorrow is invisible by default,
 * which is the correct direction for that failure to point.
 */

/** Headers worth keeping: routing/diagnostic value, no credential value. */
const SAFE_REQUEST_HEADERS: readonly string[] = [
  'content-type',
  'content-length',
  'accept',
  'user-agent',
  'referer',
  'origin',
  'x-request-id',
  'traceparent',
];

/**
 * Structurally typed rather than `Partial<IncomingMessage>`: `pino-http`
 * augments `IncomingMessage` with its own `id: ReqId`, and Express adds
 * `originalUrl`/`route`/`ip`, so extending either one drags in a declaration
 * we would then have to fight. A serializer only needs the fields it reads.
 */
interface RequestLike {
  id?: unknown;
  method?: string;
  url?: string;
  originalUrl?: string;
  route?: { path?: string };
  ip?: string;
  headers?: NodeJS.Dict<string | string[]>;
}

interface ResponseLike {
  statusCode?: number;
}

/**
 * Drops the query string. §31 asks for data minimisation and query strings
 * routinely carry reset tokens, invitation tokens and search terms — none of
 * which belong in an access log.
 */
function pathOnly(url: string | undefined): string | undefined {
  if (url === undefined) {
    return undefined;
  }
  const queryStart = url.indexOf('?');
  return queryStart === -1 ? url : url.slice(0, queryStart);
}

/**
 * Truncates an IPv4 address to its /16 and an IPv6 to its first block.
 * §31 gives `197.0.x.x` as the intended shape: enough to see "same network,
 * many failures", not enough to be a personal identifier at rest.
 */
export function truncateIp(ip: string | undefined): string | undefined {
  if (ip === undefined || ip === '') {
    return undefined;
  }

  if (ip.includes(':')) {
    const [first = ''] = ip.split(':');
    return `${first}:x:x:x`;
  }

  const octets = ip.split('.');
  if (octets.length !== 4) {
    return undefined;
  }
  return `${octets[0] ?? ''}.${octets[1] ?? ''}.x.x`;
}

function pickSafeHeaders(
  headers: NodeJS.Dict<string | string[]> | undefined,
): Record<string, string | string[]> {
  if (!headers) {
    return {};
  }

  const safe: Record<string, string | string[]> = {};
  for (const name of SAFE_REQUEST_HEADERS) {
    const value = headers[name];
    if (value !== undefined) {
      safe[name] = value;
    }
  }
  return safe;
}

export function serializeRequest(
  request: RequestLike,
): Record<string, unknown> {
  return {
    id: request.id,
    method: request.method,
    // The route *template* (`/events/:eventId`), when Express has matched one:
    // §19's example logs a template, not a concrete path, so that a dashboard
    // can group by endpoint instead of by identifier.
    route: request.route?.path,
    path: pathOnly(request.originalUrl ?? request.url),
    headers: pickSafeHeaders(request.headers),
    remoteAddress: truncateIp(request.ip),
  };
}

export function serializeResponse(
  response: ResponseLike,
): Record<string, unknown> {
  // Status only. Response headers are omitted wholesale: the one that matters
  // for security (`set-cookie`) carries session material, and none of the
  // others earns its place in every access log line.
  return { statusCode: response.statusCode };
}

/**
 * `{ type, message, stack }` — the shape the corpus implies wherever it shows
 * an error being logged, made explicit here.
 *
 * The stack stays: this object is written to the log store, which is
 * server-side. It is `HttpExceptionFilter`'s job to keep it out of the HTTP
 * *response* (§39.4 wants both facts asserted separately), and it does.
 */
export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      type: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  // Idempotent on an already-serialized error.
  //
  // `pino-http` wraps whatever `err` serializer it is given in
  // `pino-std-serializers.wrapErrorSerializer`, which runs the *standard*
  // serializer first and hands this function the resulting plain object —
  // not the original `Error`. Without this branch the second pass falls
  // through to the `NonError` case below and every logged 5xx comes out as
  // `{"type":"NonError","message":"[object Object]"}`, which is exactly the
  // information an on-call engineer needed. Observed in the e2e output
  // before this was added.
  if (isSerializedError(error)) {
    return { ...error };
  }

  return { type: 'NonError', message: String(error) };
}

function isSerializedError(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.message === 'string' &&
    (typeof candidate.type === 'string' || typeof candidate.stack === 'string')
  );
}

export const LOG_SERIALIZERS = {
  req: serializeRequest,
  res: serializeResponse,
  err: serializeError,
};
