/**
 * Raised when a query on a tenant-owned model carries no `organizationId`
 * constraint — sprint-03 EVT-018, ADR-0003.
 *
 * ## Why this is not an `AppException`
 *
 * Every other failure in this codebase that reaches a client is an
 * `AppException` with an RFC 9457 shape. This one deliberately is not, and
 * the difference is the point: an `AppException` describes something the
 * *caller* did wrong and is designed to be rendered into a response. A
 * tenant-scope violation describes something the *code* got wrong. It is a
 * programming error, in the same family as calling a method that does not
 * exist, and it should surface as a 500 with a stack trace pointing at the
 * repository that wrote the query — not as a tidy 4xx that a caller might
 * reasonably retry.
 *
 * The global exception filter already turns an unrecognised error into a 500
 * with `UNHANDLED_APPLICATION_ERROR` and no detail leaked to the client, which
 * is exactly the right handling. Adding a bespoke status code here would make
 * the failure look expected.
 */
export class TenantScopeViolationError extends Error {
  readonly model: string;
  readonly operation: string;

  constructor(model: string, operation: string, reason: string) {
    super(
      `${model}.${operation} ran without an organizationId constraint: ` +
        `${reason}. Every query on a tenant-owned model must be scoped ` +
        `(ADR-0003). Pass the TenantContext through, or wrap a genuine ` +
        `platform operation in prisma.$unscoped(reason, fn).`,
    );

    this.name = 'TenantScopeViolationError';
    this.model = model;
    this.operation = operation;

    // Without this the stack starts inside the extension rather than at the
    // call site, which is the one piece of information a reader needs.
    Error.captureStackTrace(this, TenantScopeViolationError);
  }
}
