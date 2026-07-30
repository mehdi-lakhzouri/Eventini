import { environment } from "@/config/environment";
import { ApiError } from "./api-error";
import { withCsrfHeader } from "./csrf-client";
import {
  serializeRequestBody,
  shouldSetJsonContentType,
  type RequestBody,
} from "./request-body";

/**
 * `body` is omitted from `RequestInit` before being re-added.
 *
 * Intersecting instead of omitting gave `body` the type
 * `(BodyInit | null) & (BodyInit | Record<string, unknown> | undefined)`,
 * which nothing can satisfy — the three TS2345/TS2322 errors this ticket
 * cleared.
 */
export type ApiRequestOptions = Omit<RequestInit, "body" | "method"> & {
  body?: RequestBody;
};

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function request<T>(
  path: string,
  method: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const headers = MUTATING_METHODS.has(method)
    ? withCsrfHeader(options.headers)
    : new Headers(options.headers);

  if (shouldSetJsonContentType(options.body)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${environment.apiBaseUrl}${path}`, {
    ...options,
    method,
    headers,
    // Cookie-based authentication: the access, refresh and CSRF cookies are
    // HttpOnly and must ride along. No token is ever read from JavaScript
    // (AUTH-INV-001).
    credentials: "include",
    body: serializeRequestBody(options.body),
  });

  if (!response.ok) {
    // TODO(EVT-037, sprint 07): read the RFC 9457 problem body and populate
    // code, title, detail, field errors, retryable and requestId. Today the
    // response body is discarded, so the backend's error catalogue never
    // reaches the UI.
    throw new ApiError(response.statusText, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const apiClient = {
  get: <T>(path: string, options?: ApiRequestOptions) =>
    request<T>(path, "GET", options),
  post: <T>(path: string, body?: RequestBody, options?: ApiRequestOptions) =>
    request<T>(path, "POST", { ...options, body }),
  put: <T>(path: string, body?: RequestBody, options?: ApiRequestOptions) =>
    request<T>(path, "PUT", { ...options, body }),
  patch: <T>(path: string, body?: RequestBody, options?: ApiRequestOptions) =>
    request<T>(path, "PATCH", { ...options, body }),
  delete: <T>(path: string, options?: ApiRequestOptions) =>
    request<T>(path, "DELETE", options),
};
