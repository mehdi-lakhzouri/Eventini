import { SENSITIVE_KEYS } from '../logging/log-redaction.config';

/**
 * The marker written in place of a sensitive value — DATABASE_SCHEMA.md §8.2
 * and the EVT-016 ticket both spell it exactly this way. Uppercase, and
 * deliberately not the logging layer's `[Redacted]`: the two appear in
 * different artefacts read by different people, and an auditor comparing an
 * audit row against a log line should be able to tell which system produced
 * which.
 */
export const AUDIT_REDACTION_MARKER = '[REDACTED]';

const SENSITIVE_KEY_SET = new Set(
  SENSITIVE_KEYS.map((key) => key.toLowerCase()),
);

/**
 * Guards against a cyclic or pathologically nested structure turning an audit
 * write into a hang. Deeper than the logging scrubber's bound because an
 * audit diff is a deliberately-constructed object rather than whatever was
 * passed to a logger, so legitimate depth is both known and small.
 */
const MAX_DEPTH = 12;

/**
 * Redacts sensitive values in an audit diff — **without ever dropping the
 * key**.
 *
 * ## Why omission is forbidden, and this is not the logging scrubber
 *
 * The logging layer's job is to keep secrets out of a log store, so removing
 * a field entirely is a perfectly good outcome there. Here it is the wrong
 * one, and §8.2 says so explicitly: *"les champs sensibles sont remplacés par
 * `[REDACTED]`, jamais omis — l'omission masquerait le fait qu'ils ont
 * changé."*
 *
 * The audit trail's question is "what changed". If a password hash is dropped
 * from `previousValues` and `newValues`, the row says the password did not
 * change — which is exactly backwards, and exactly what someone covering
 * their tracks would want it to say. Keeping the key with a redacted value
 * records the fact of the change while disclosing nothing about it.
 *
 * So the two functions look similar and mean opposite things, and reusing
 * `scrubSensitiveKeys` here would have been a subtle, plausible mistake:
 * it censors values too, but its contract permits omission and its marker
 * differs. Only the key *list* is shared, which is the part that genuinely
 * should not diverge.
 */
export function redactAuditValues(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactAuditValues(item, depth + 1));
  }

  // Dates, Buffers and class instances are returned untouched: walking them
  // would rewrite them into meaningless plain objects, and none is a place a
  // bare secret key lives.
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }

  const result: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY_SET.has(key.toLowerCase())
      ? AUDIT_REDACTION_MARKER
      : redactAuditValues(nested, depth + 1);
  }

  return result;
}

export interface AuditDiff {
  readonly previousValues: Record<string, unknown> | null;
  readonly newValues: Record<string, unknown> | null;
}

/**
 * Builds the `previous_values` / `new_values` pair for an audit row.
 *
 * Both sides go through the same redaction so a field cannot be revealed on
 * one side and hidden on the other — which would leak the value while looking
 * redacted.
 */
export function buildAuditDiff(
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
): AuditDiff {
  return {
    previousValues:
      previous == null
        ? null
        : (redactAuditValues(previous) as Record<string, unknown>),
    newValues:
      next == null
        ? null
        : (redactAuditValues(next) as Record<string, unknown>),
  };
}
