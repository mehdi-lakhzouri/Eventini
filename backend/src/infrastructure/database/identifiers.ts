import { uuidV7 } from './uuid-v7';

/**
 * The readable prefixes DATABASE_SCHEMA.md §2.1 requires on every identifier
 * that appears in an API or a URL.
 *
 * They are not decoration. An identifier that carries its type turns a whole
 * class of bug — passing an event id where a session id was expected — into
 * something visible in a log line, a URL and a stack trace, rather than a
 * silent lookup that returns nothing.
 */
export const ID_PREFIXES = {
  user: 'usr',
  organization: 'org',
  membership: 'mbr',
  session: 'ses',
  role: 'rol',
  permission: 'perm',
  event: 'evt',
  eventSession: 'esn',
  participant: 'par',
  registration: 'reg',
  ticket: 'tkt',
  attendance: 'att',
  device: 'dev',
  invitation: 'inv',
  auditLog: 'aud',
  securityEvent: 'sec',
  idempotency: 'idm',
  outbox: 'obx',

  /**
   * Not in §2.1's list, and added here deliberately rather than by oversight.
   *
   * That list covers identifiers "exposed in an API or a URL", and the three
   * assignment tables — `membership_role_assignments`,
   * `platform_role_assignments`, `event_user_assignments` — are addressed
   * through their membership or user, never by their own id. They still need
   * a primary key, and the alternatives were worse: reusing `rol_` would put
   * a role prefix on a row that is not a role, and dropping the prefix would
   * make these the only bare UUIDs in the schema, so anything reading a log
   * line would have to know which columns are exceptions.
   */
  assignment: 'asg',
} as const;

export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

/**
 * Generates a prefixed UUID v7.
 *
 * ## Why v7 and not v4
 *
 * §2.1 is specific: v7 embeds a millisecond timestamp in its high bits, so
 * generated ids sort roughly by creation time. That preserves insertion
 * locality in a B-tree index, which matters on the tables that grow fastest —
 * `attendance_records` during an event, and `audit_logs` continuously. A v4
 * scatters inserts across the whole index, turning what should be appends
 * into random page writes.
 *
 * ## Why not SERIAL
 *
 * Also §2.1, and the reason is security rather than performance: a sequential
 * identifier is enumerable, which hands an attacker both IDOR targets and a
 * free reading of how much activity the system has. A UUID discloses neither.
 *
 * ## Why the application generates them
 *
 * The id exists before the insert, so a use case can build a whole object
 * graph — an event, its sessions, the audit entry describing their creation —
 * and write it in one transaction, without a round trip per row to learn what
 * the database chose.
 */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${uuidV7()}`;
}

/** Whether a value looks like an identifier this module produced. */
export function hasPrefix(id: string, prefix: IdPrefix): boolean {
  return id.startsWith(`${prefix}_`);
}
