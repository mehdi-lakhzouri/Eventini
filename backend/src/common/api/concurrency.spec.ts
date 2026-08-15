import type { Request } from 'express';

import { AppException } from './app-exception';
import { requireIfMatch, toETag, versionedWriteException } from './concurrency';

/** A request carrying exactly the headers a test names, and nothing else. */
function requestWith(headers: Record<string, string>): Request {
  return {
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

const codeOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return error instanceof AppException ? error.code : 'NOT_AN_APP_EXCEPTION';
  }

  return 'DID_NOT_THROW';
};

describe('toETag', () => {
  it('quotes the version, because an unquoted entity-tag is malformed', () => {
    expect(toETag(3)).toBe('"3"');
  });

  it('round-trips through requireIfMatch', () => {
    expect(requireIfMatch(requestWith({ 'if-match': toETag(42) }))).toBe(42);
  });
});

describe('requireIfMatch', () => {
  it.each([
    ['a quoted tag', '"7"', 7],
    ['a weak tag an intermediary may have produced', 'W/"7"', 7],
    ['a bare number', '7', 7],
    ['surrounding whitespace', '  "7"  ', 7],
  ])('accepts %s', (_name, header, expected) => {
    expect(requireIfMatch(requestWith({ 'if-match': header }))).toBe(expected);
  });

  /**
   * 🔴 The header is required, not optional.
   *
   * A caller that has not read the resource cannot know its version; one that
   * has read it already holds the tag. Accepting a blind write means the
   * second of two concurrent editors silently erases the first, with no error
   * and nothing in the audit trail that reads as a loss.
   */
  it.each([
    ['absent', {}],
    ['empty', { 'if-match': '' }],
    ['whitespace only', { 'if-match': '   ' }],
  ])('answers 428 when the header is %s', (_name, headers) => {
    expect(codeOf(() => requireIfMatch(requestWith(headers)))).toBe(
      'PRECONDITION_REQUIRED',
    );
  });

  /**
   * `If-Match: *` is valid HTTP and refused here on purpose: it means
   * "whatever is currently there", which on this route is a documented way to
   * opt out of the very guarantee it is meant to provide.
   */
  it('refuses the wildcard rather than treating it as consent', () => {
    expect(codeOf(() => requireIfMatch(requestWith({ 'if-match': '*' })))).toBe(
      'PRECONDITION_REQUIRED',
    );
  });

  /**
   * A list means "any of these", which on a single-version row can only be an
   * accident — and guessing which one the caller meant would be worse.
   */
  it('refuses a list of tags', () => {
    expect(
      codeOf(() => requireIfMatch(requestWith({ 'if-match': '"3", "4"' }))),
    ).toBe('PRECONDITION_FAILED');
  });

  /**
   * `Number` happily accepts these. Each would produce a version the caller
   * never sent: `0x10` is 16, `1e3` is 1000, and an empty tag is 0.
   */
  it.each([
    ['hexadecimal', '"0x10"'],
    ['exponent notation', '"1e3"'],
    ['a negative number', '"-1"'],
    ['a decimal', '"1.5"'],
    ['a non-number', '"abc"'],
    ['an empty tag', '""'],
    ['zero, which no row ever has', '"0"'],
  ])('answers 412 on %s', (_name, header) => {
    expect(
      codeOf(() => requireIfMatch(requestWith({ 'if-match': header }))),
    ).toBe('PRECONDITION_FAILED');
  });

  it('reads the header case-insensitively, as HTTP requires', () => {
    expect(requireIfMatch(requestWith({ 'if-match': '"5"' }))).toBe(5);
  });
});

describe('versionedWriteException', () => {
  it('separates a missing resource from one that moved on', () => {
    expect(versionedWriteException('NOT_FOUND', 'Organization').code).toBe(
      'RESOURCE_NOT_FOUND',
    );
    expect(versionedWriteException('CONFLICT', 'Organization').code).toBe(
      'VERSION_CONFLICT',
    );
  });

  /**
   * A conflict is worth retrying — after re-reading. Marking it retryable is
   * what lets a client distinguish it from a validation failure, which
   * retrying identically would never fix.
   */
  it('marks a conflict retryable and names the resource', () => {
    const exception = versionedWriteException('CONFLICT', 'Organization');

    // `retryable` and `detail` are properties of `AppException` itself, not of
    // the `HttpException` response body — that body is the detail string.
    expect(exception.retryable).toBe(true);
    expect(exception.detail).toContain('Organization');
  });
});
