import { stripQueryString } from './strip-query-string';

describe('stripQueryString', () => {
  it('removes a query string', () => {
    expect(stripQueryString('/api/v1/reset?token=SECRET')).toBe(
      '/api/v1/reset',
    );
  });

  it('leaves a path without a query string alone', () => {
    expect(stripQueryString('/api/v1/events')).toBe('/api/v1/events');
  });

  it('handles a bare question mark', () => {
    expect(stripQueryString('/api/v1/events?')).toBe('/api/v1/events');
  });

  it('removes everything after the first question mark', () => {
    expect(stripQueryString('/a?b=1?c=2')).toBe('/a');
  });
});
