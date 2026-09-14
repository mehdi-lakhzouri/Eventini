/**
 * The window arithmetic shared by every keyset-paginated list.
 *
 * Kept free of Prisma so it can be tested exhaustively on arrays: the rules
 * are easy to get subtly wrong — one row too many, a previous page reported
 * as next — and none of them depend on how the rows were fetched.
 */

export type PageDirection = 'after' | 'before';

export type SortOrder = 'asc' | 'desc';

export interface PageWindow<T> {
  readonly items: T[];
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
}

/**
 * The order a query must run in to fetch a window.
 *
 * Walking backwards (`before`) reads the rows nearest the boundary first,
 * which means the opposite of the requested order — the window is reversed
 * back into the requested order afterwards by `toPageWindow`.
 */
export function fetchOrder(
  order: SortOrder,
  direction: PageDirection,
): SortOrder {
  if (direction === 'after') {
    return order;
  }

  return order === 'asc' ? 'desc' : 'asc';
}

/**
 * Turns `limit + 1` fetched rows into a page.
 *
 * The extra row is what answers "is there more?" without a `COUNT(*)`
 * (API_CONVENTIONS.md §6): it is never returned, only observed.
 *
 * On a forward read the opposite edge is inferred from the cursor alone — a
 * caller holding an `after` cursor came from somewhere. Rows deleted since can
 * make that edge stale; the next backward read then simply returns nothing,
 * which is the honest answer rather than an error.
 */
export function toPageWindow<T>(
  rows: readonly T[],
  limit: number,
  direction: PageDirection,
  hasCursor: boolean,
): PageWindow<T> {
  const hasMore = rows.length > limit;
  const window = rows.slice(0, limit);

  if (direction === 'after') {
    return { items: window, hasNextPage: hasMore, hasPreviousPage: hasCursor };
  }

  return {
    items: window.reverse(),
    hasNextPage: hasCursor,
    hasPreviousPage: hasMore,
  };
}
