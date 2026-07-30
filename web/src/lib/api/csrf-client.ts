import { csrfHeaderName } from "@/features/authentication/constants/authentication.constants";

const csrfCookieName = "csrf-token";

export function readCsrfToken() {
  if (typeof document === "undefined") {
    return null;
  }

  const csrfCookie = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${csrfCookieName}=`));

  return csrfCookie ? decodeURIComponent(csrfCookie.split("=")[1] ?? "") : null;
}

export function withCsrfHeader(headers: HeadersInit = {}) {
  const token = readCsrfToken();
  const nextHeaders = new Headers(headers);

  if (token) {
    nextHeaders.set(csrfHeaderName, token);
  }

  return nextHeaders;
}
