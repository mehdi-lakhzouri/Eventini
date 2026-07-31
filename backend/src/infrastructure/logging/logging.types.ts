import type { LogCategory } from './log-categories';
import type { LogEventCode } from './log-event-codes';

/** §9.2 — correlation fields. */
export interface CorrelationFields {
  requestId?: string;
  traceId?: string;
  spanId?: string;
}

/**
 * §9.3 / §9.4 — tenant and identity fields.
 *
 * Every one of these must be the value the *server* resolved, never a value
 * read off the request body: §13 is explicit that
 * `organizationId = req.body.organizationId` is the wrong shape, because it
 * lets a caller forge which tenant an event appears to belong to and so
 * corrupts the audit trail rather than merely mislabelling a log line.
 */
export interface TenantFields {
  organizationId?: string;
  eventId?: string;
  membershipId?: string;
  userId?: string;
  sessionId?: string;
  deviceId?: string;
  scannerId?: string;
}

/** §9.6 — outcome fields. */
export interface ResultFields {
  operation?: string;
  result?: 'SUCCESS' | 'FAILURE';
  reasonCode?: string;
  errorCode?: string;
  durationMs?: number;
}

/**
 * A structured log payload. `eventCode` and `category` are required together
 * so a line is always queryable by both — §8 makes the pair the primary way
 * dashboards slice logs.
 */
export interface StructuredLogFields
  extends CorrelationFields, TenantFields, ResultFields {
  eventCode: LogEventCode;
  category: LogCategory;
}
