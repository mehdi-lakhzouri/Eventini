import { afterEach, describe, expect, it } from "vitest";

import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  readCsrfToken,
  withCsrfHeader,
} from "./csrf-client";

function setCookie(raw: string): void {
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => raw,
  });
}

describe("readCsrfToken", () => {
  afterEach(() => {
    setCookie("");
  });

  it("returns null when the cookie is absent", () => {
    setCookie("theme=dark; other=1");

    expect(readCsrfToken()).toBeNull();
  });

  it("reads the token from the documented cookie name", () => {
    setCookie(`${CSRF_COOKIE_NAME}=abc123`);

    expect(readCsrfToken()).toBe("abc123");
  });

  it("keeps a token containing '=' intact", () => {
    // base64url padding is a real case, and split("=") used to truncate it.
    setCookie(`${CSRF_COOKIE_NAME}=YWJjZGVm==`);

    expect(readCsrfToken()).toBe("YWJjZGVm==");
  });

  it("percent-decodes the value", () => {
    setCookie(`${CSRF_COOKIE_NAME}=a%2Bb`);

    expect(readCsrfToken()).toBe("a+b");
  });

  it("treats an empty value as absent", () => {
    setCookie(`${CSRF_COOKIE_NAME}=`);

    expect(readCsrfToken()).toBeNull();
  });

  it("is not confused by a cookie whose name merely starts the same", () => {
    setCookie(`${CSRF_COOKIE_NAME}_other=wrong; ${CSRF_COOKIE_NAME}=right`);

    expect(readCsrfToken()).toBe("right");
  });
});

describe("withCsrfHeader", () => {
  afterEach(() => {
    setCookie("");
  });

  it("adds the header when a token exists", () => {
    setCookie(`${CSRF_COOKIE_NAME}=token-value`);

    expect(withCsrfHeader().get(CSRF_HEADER_NAME)).toBe("token-value");
  });

  it("adds no header at all when there is no token", () => {
    setCookie("");

    // Not an empty header: the server would compare "" against a real cookie
    // and log a mismatch that looks like an attack.
    expect(withCsrfHeader().has(CSRF_HEADER_NAME)).toBe(false);
  });

  it("preserves headers it was given", () => {
    setCookie(`${CSRF_COOKIE_NAME}=token-value`);

    const headers = withCsrfHeader({ "X-Request-Id": "req_01" });

    expect(headers.get("X-Request-Id")).toBe("req_01");
    expect(headers.get(CSRF_HEADER_NAME)).toBe("token-value");
  });
});
