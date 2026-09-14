import { buildResponseMeta } from './build-response-meta';

describe('buildResponseMeta', () => {
  it('echoes the given request ID and a fixed apiVersion', () => {
    const meta = buildResponseMeta('req_abc123');
    expect(meta.requestId).toBe('req_abc123');
    expect(meta.apiVersion).toBe('v1');
  });

  it('produces a valid ISO 8601 timestamp', () => {
    const meta = buildResponseMeta('req_abc123');
    expect(new Date(meta.timestamp).toISOString()).toBe(meta.timestamp);
  });

  it('omits pagination unless a list handler attached it', () => {
    expect(buildResponseMeta('req_abc123')).not.toHaveProperty('pagination');
  });

  it('carries the pagination a list handler attached', () => {
    const pagination = {
      limit: 20,
      hasNextPage: true,
      hasPreviousPage: false,
      nextCursor: 'abc.def',
      previousCursor: null,
    };

    expect(buildResponseMeta('req_abc123', undefined, pagination)).toEqual(
      expect.objectContaining({ pagination }),
    );
  });
});
