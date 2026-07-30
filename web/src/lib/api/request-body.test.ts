import { describe, expect, it } from "vitest";

import {
  serializeRequestBody,
  shouldSetJsonContentType,
} from "./request-body";

describe("serializeRequestBody", () => {
  it("returns undefined for a bodiless request", () => {
    expect(serializeRequestBody(undefined)).toBeUndefined();
  });

  it("JSON-encodes a plain object", () => {
    expect(serializeRequestBody({ email: "a@b.c" })).toBe('{"email":"a@b.c"}');
  });

  it("passes FormData through untouched", () => {
    const form = new FormData();
    form.append("file", "contents");

    // Identity, not equality: re-encoding it would destroy the multipart
    // boundary the browser is about to generate.
    expect(serializeRequestBody(form)).toBe(form);
  });
});

describe("shouldSetJsonContentType", () => {
  it("is true for a plain object", () => {
    expect(shouldSetJsonContentType({ a: 1 })).toBe(true);
  });

  it("is false for FormData, so the browser can set its own boundary", () => {
    expect(shouldSetJsonContentType(new FormData())).toBe(false);
  });

  it("is false when there is no body", () => {
    expect(shouldSetJsonContentType(undefined)).toBe(false);
  });
});
