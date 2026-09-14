import { fetchOrder, toPageWindow } from './keyset-page';

describe('keyset page window', () => {
  describe('fetchOrder', () => {
    it('keeps the requested order when reading forward', () => {
      expect(fetchOrder('desc', 'after')).toBe('desc');
      expect(fetchOrder('asc', 'after')).toBe('asc');
    });

    it('inverts the order when reading backward', () => {
      expect(fetchOrder('desc', 'before')).toBe('asc');
      expect(fetchOrder('asc', 'before')).toBe('desc');
    });
  });

  describe('forward', () => {
    it('uses the extra row only to report a next page', () => {
      expect(toPageWindow([1, 2, 3], 2, 'after', false)).toEqual({
        items: [1, 2],
        hasNextPage: true,
        hasPreviousPage: false,
      });
    });

    it('reports no next page when the extra row is absent', () => {
      expect(toPageWindow([1, 2], 2, 'after', false)).toEqual({
        items: [1, 2],
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });

    it('reports a previous page once a cursor was followed', () => {
      expect(toPageWindow([3], 2, 'after', true).hasPreviousPage).toBe(true);
    });
  });

  describe('backward', () => {
    it('restores the requested order and reports the far edge', () => {
      // Fetched nearest-first in inverted order: 4, 3, then the extra row 2.
      expect(toPageWindow([4, 3, 2], 2, 'before', true)).toEqual({
        items: [3, 4],
        hasNextPage: true,
        hasPreviousPage: true,
      });
    });

    it('reports no previous page at the start of the list', () => {
      expect(toPageWindow([2, 1], 2, 'before', true)).toEqual({
        items: [1, 2],
        hasNextPage: true,
        hasPreviousPage: false,
      });
    });
  });

  it('never mutates the fetched rows', () => {
    const rows = [4, 3, 2];
    toPageWindow(rows, 2, 'before', true);

    expect(rows).toEqual([4, 3, 2]);
  });
});
