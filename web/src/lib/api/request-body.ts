/**
 * What the API client accepts as a request body.
 *
 * Deliberately narrower than `BodyInit`. Eventini sends JSON everywhere except
 * participant imports, which send a file. Accepting the full `BodyInit` union
 * bought nothing and produced the impossible intersection that made
 * `RequestInit & { body?: RequestBody }` untypeable.
 */
export type RequestBody = FormData | Record<string, unknown> | undefined;

/**
 * Turns a body into something `fetch` accepts.
 *
 * `FormData` passes through untouched: the browser has to set
 * `Content-Type: multipart/form-data` itself, because only it knows the
 * boundary string. Setting that header by hand produces a request the server
 * cannot parse.
 */
export function serializeRequestBody(body: RequestBody): BodyInit | undefined {
  if (body === undefined) {
    return undefined;
  }

  if (body instanceof FormData) {
    return body;
  }

  return JSON.stringify(body);
}

/**
 * Whether the client should set `Content-Type: application/json` itself.
 *
 * False for `FormData` — see above — and false when there is no body at all: a
 * `Content-Type` on a bodiless request is meaningless and some proxies treat it
 * as malformed.
 */
export function shouldSetJsonContentType(body: RequestBody): boolean {
  return body !== undefined && !(body instanceof FormData);
}
