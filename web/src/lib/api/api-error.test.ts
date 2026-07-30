import { describe, expect, it } from "vitest";

import { ApiError } from "./api-error";

/**
 * Documents the current shape of ApiError.
 *
 * EVT-037 (sprint 07) widens it to carry the RFC 9457 problem details the
 * backend actually returns — code, title, detail, field errors, retryable,
 * requestId. These tests are the regression net for that change: whatever is
 * added, the basics asserted here must keep holding.
 */
describe("ApiError", () => {
  it("is a real Error, so instanceof and try/catch behave normally", () => {
    const error = new ApiError("Not found", 404);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApiError);
  });

  it("carries the HTTP status alongside the message", () => {
    const error = new ApiError("Tenant access denied", 403);

    expect(error.message).toBe("Tenant access denied");
    expect(error.status).toBe(403);
  });

  it("names itself ApiError rather than Error", () => {
    // Without the explicit assignment in the constructor this reports "Error",
    // which makes production stack traces ambiguous.
    expect(new ApiError("boom", 500).name).toBe("ApiError");
  });

  it("leaves details undefined when none are supplied", () => {
    expect(new ApiError("boom", 500).details).toBeUndefined();
  });

  it("preserves details when supplied", () => {
    const details = { field: "startsAt", code: "REQUIRED" };
    const error = new ApiError("Validation failed", 400, details);

    expect(error.details).toEqual(details);
  });
});
