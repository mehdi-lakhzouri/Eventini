/**
 * Deciding whether a Prisma operation is scoped to one organization —
 * sprint-03 EVT-018, ADR-0003.
 *
 * This file is the whole guard. Everything else around it is plumbing; if
 * this function says yes when it should say no, the isolation is gone and
 * nothing downstream will notice. It is written to be readable rather than
 * clever for that reason, and every rule below has a test.
 *
 * The shapes it inspects were read off a live client rather than recalled:
 * `args` arrives exactly as the caller wrote it, `model` is the PascalCase
 * model name, and a bare `count()` arrives as `{}` — no `where` key at all.
 */

const SCOPE_FIELD = 'organizationId';

/** Prisma operations whose scope lives in `data` rather than in `where`. */
const CREATE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
]);

export interface ScopeVerdict {
  readonly scoped: boolean;
  /** Why not, phrased for the error message. Empty when `scoped`. */
  readonly reason: string;
}

const SCOPED: ScopeVerdict = { scoped: true, reason: '' };

function unscoped(reason: string): ScopeVerdict {
  return { scoped: false, reason };
}

/**
 * Whether a value constrains `organizationId` to a known set.
 *
 * Accepted: a literal id, `{ equals: id }`, and `{ in: [...] }` with at least
 * one entry — all of them bound the query to organizations the caller named.
 *
 * Rejected, and this is the interesting half:
 *
 * - `{ not: id }` and `{ notIn: [...] }` mention the field while selecting
 *   *every other tenant*. They are the exact inverse of a scope, and a naive
 *   "does the where mention organizationId" check would pass them.
 * - `null` — a tenant-owned column is `NOT NULL`, so this matches nothing and
 *   is a bug rather than a scope.
 * - `{ in: [] }` — matches nothing. Harmless in effect, but it is always a
 *   mistake, and accepting it would mean the guard blesses a query that
 *   silently returns no rows.
 * - String comparators (`contains`, `startsWith`, …) — a prefix match across
 *   tenant ids is not a scope.
 */
export function isScopingConstraint(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.length > 0;
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const filter = value as Record<string, unknown>;

  if (typeof filter['equals'] === 'string' && filter['equals'].length > 0) {
    return true;
  }

  const inValues = filter['in'];
  if (Array.isArray(inValues) && inValues.length > 0) {
    return inValues.every(
      (entry) => typeof entry === 'string' && entry.length > 0,
    );
  }

  return false;
}

/**
 * Whether a `where` clause constrains the organization.
 *
 * The recursion is where the subtlety lives:
 *
 * - `AND` narrows, so **one** scoped branch scopes the whole clause.
 * - `OR` widens, so **every** branch must be scoped. `{ OR: [{ organizationId
 *   }, { id }] }` mentions the field and returns rows from every tenant — the
 *   single most plausible way to write an unscoped query that looks scoped.
 * - `NOT` is ignored entirely. A negation cannot bound a query to a tenant,
 *   and treating anything inside it as evidence of scope would be exactly
 *   backwards.
 * - Relation filters (`organization: { id }`) are not accepted. §2.4
 *   denormalises `organization_id` onto every tenant-owned table precisely so
 *   the guard needs no join; honouring a relation filter here would reward
 *   the query shape the schema was designed to make unnecessary.
 */
export function whereHasOrganizationScope(
  where: unknown,
  via?: string,
): boolean {
  if (where === null || typeof where !== 'object' || Array.isArray(where)) {
    return false;
  }

  const clause = where as Record<string, unknown>;

  if (SCOPE_FIELD in clause && isScopingConstraint(clause[SCOPE_FIELD])) {
    return true;
  }

  // The relation form, allowed only for the models that have no column of
  // their own — `MembershipRoleAssignment` today. `via` is passed in by the
  // ownership registry rather than sniffed from the clause, so a model that
  // *does* have the column cannot be scoped this way and dodge §2.4.
  if (via !== undefined) {
    const relation = clause[via];

    if (relation !== null && typeof relation === 'object') {
      const nested = relation as Record<string, unknown>;

      // Prisma writes a to-one relation filter either bare or under `is`.
      if (isScopingConstraint(nested[SCOPE_FIELD])) {
        return true;
      }

      const is = nested['is'];
      if (
        is !== null &&
        typeof is === 'object' &&
        isScopingConstraint((is as Record<string, unknown>)[SCOPE_FIELD])
      ) {
        return true;
      }
    }
  }

  const and = clause['AND'];
  if (and !== undefined) {
    const branches = Array.isArray(and) ? and : [and];
    if (branches.some((branch) => whereHasOrganizationScope(branch, via))) {
      return true;
    }
  }

  const or = clause['OR'];
  if (Array.isArray(or) && or.length > 0) {
    if (or.every((branch) => whereHasOrganizationScope(branch, via))) {
      return true;
    }
  }

  return false;
}

/** Whether a `data` payload sets the organization on the row being created. */
export function dataHasOrganizationScope(data: unknown, via?: string): boolean {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return false;
  }

  const payload = data as Record<string, unknown>;

  const direct = payload[SCOPE_FIELD];
  if (typeof direct === 'string' && direct.length > 0) {
    return true;
  }

  // A model with no column of its own inherits the tenant from the row it
  // points at, so naming that row is the strongest statement available at
  // insert time. INV-09's trigger is what actually holds the two consistent.
  if (via !== undefined) {
    const relation = payload[via];

    if (relation !== null && typeof relation === 'object') {
      const connect = (relation as Record<string, unknown>)['connect'];

      if (connect !== null && typeof connect === 'object') {
        const id = (connect as Record<string, unknown>)['id'];
        if (typeof id === 'string' && id.length > 0) {
          return true;
        }
      }
    }

    const foreignKey = payload[`${via}Id`];
    if (typeof foreignKey === 'string' && foreignKey.length > 0) {
      return true;
    }
  }

  // Prisma's relation form: `organization: { connect: { id } }`. Accepted
  // here, unlike in a `where`, because it writes the foreign key rather than
  // asking the database to resolve one — the row still ends up carrying its
  // own `organization_id`, which is all the guard is protecting.
  const relation = payload['organization'];
  if (relation !== null && typeof relation === 'object') {
    const connect = (relation as Record<string, unknown>)['connect'];
    if (connect !== null && typeof connect === 'object') {
      const id = (connect as Record<string, unknown>)['id'];
      return typeof id === 'string' && id.length > 0;
    }
  }

  return false;
}

/**
 * The verdict for one operation.
 *
 * `upsert` is checked on both sides: its `where` decides which row is
 * updated, and its `create` decides what is inserted when there is none. A
 * scoped `where` with an unscoped `create` would write a row belonging to
 * nobody, so both have to hold.
 */
export function hasOrganizationScope(
  operation: string,
  args: unknown,
  via?: string,
): ScopeVerdict {
  const payload =
    args !== null && typeof args === 'object'
      ? (args as Record<string, unknown>)
      : {};

  const expected =
    via === undefined
      ? 'constrain organizationId'
      : `constrain organizationId, directly or through ${via}`;

  if (operation === 'upsert') {
    if (!whereHasOrganizationScope(payload['where'], via)) {
      return unscoped(`its where clause does not ${expected}`);
    }
    if (!dataHasOrganizationScope(payload['create'], via)) {
      return unscoped('its create payload does not set organizationId');
    }
    return SCOPED;
  }

  if (CREATE_OPERATIONS.has(operation)) {
    const data = payload['data'];

    if (Array.isArray(data)) {
      if (data.length === 0) {
        // Nothing is written, so nothing can leak. Refusing here would make
        // "create these zero rows" an error, which is a normal outcome of a
        // filtered list upstream.
        return SCOPED;
      }

      return data.every((row) => dataHasOrganizationScope(row, via))
        ? SCOPED
        : unscoped('at least one row in data does not set organizationId');
    }

    return dataHasOrganizationScope(data, via)
      ? SCOPED
      : unscoped('its data payload does not set organizationId');
  }

  // Everything else — reads, updates, deletes, aggregates — is gated on
  // `where`. An operation with no `where` at all (a bare `count()`, a
  // `findMany()`) lands here and is refused, which is correct: it reads every
  // tenant.
  return whereHasOrganizationScope(payload['where'], via)
    ? SCOPED
    : unscoped(`its where clause does not ${expected}`);
}
