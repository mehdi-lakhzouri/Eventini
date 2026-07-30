import { environment } from "@/config/environment";
import { ApiError } from "./api-error";
import { withCsrfHeader } from "./csrf-client";

type RequestBody = BodyInit | Record<string, unknown> | undefined;

const mutatingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function request<T>(
  path: string,
  options: RequestInit & { body?: RequestBody } = {},
) {
  const method = options.method?.toUpperCase() ?? "GET";
  const headers = mutatingMethods.has(method)
    ? withCsrfHeader(options.headers)
    : new Headers(options.headers);

  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${environment.apiBaseUrl}${path}`, {
    ...options,
    method,
    headers,
    credentials: "include",
    body:
      options.body && !(options.body instanceof FormData)
        ? JSON.stringify(options.body)
        : options.body,
  });

  if (!response.ok) {
    throw new ApiError(response.statusText, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const apiClient = {
  get: <T>(path: string, options?: RequestInit) =>
    request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: RequestBody, options?: RequestInit) =>
    request<T>(path, { ...options, method: "POST", body }),
  delete: <T>(path: string, options?: RequestInit) =>
    request<T>(path, { ...options, method: "DELETE" }),
};
