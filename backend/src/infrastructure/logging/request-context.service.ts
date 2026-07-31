import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import type { CorrelationFields, TenantFields } from './logging.types';

/**
 * Attaches server-resolved correlation and tenant fields to the current
 * request's logger — §11, §12 and §13.
 *
 * `nestjs-pino` keeps a per-request child logger in an `AsyncLocalStorage`,
 * so `assign` here means "every subsequent log line in this request carries
 * these fields", without any layer having to thread them through by hand.
 * That is what makes §13's requirement affordable: a use case does not need
 * to remember to add `organizationId`, so it does not get forgotten.
 *
 * ## The one rule that matters here
 *
 * §13: the tenant that gets logged must be the tenant the *server* resolved.
 * Never `req.body.organizationId`. A caller who can influence which tenant
 * their actions appear under can make a cross-tenant access look legitimate
 * in the log store, which turns the audit trail into a liability. Callers of
 * `setTenantContext` are expected to pass values that came out of the session
 * and the authorization chain, never off the wire — this service cannot
 * enforce that for them, so it is stated here and asserted in the guards that
 * will call it (EVT-018 onward).
 */
@Injectable()
export class RequestContextService {
  constructor(private readonly logger: PinoLogger) {}

  /** §11/§12 — request and trace correlation. */
  setCorrelation(fields: CorrelationFields): void {
    this.logger.assign(stripUndefined(fields));
  }

  /** §13 — server-resolved tenant and identity. */
  setTenantContext(fields: TenantFields): void {
    this.logger.assign(stripUndefined(fields));
  }
}

/**
 * Pino writes `"userId": undefined` as a present-but-null-ish key in some
 * serialisers; dropping the key entirely keeps "field absent" and "field
 * genuinely empty" distinguishable in a query.
 */
function stripUndefined(fields: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
}
