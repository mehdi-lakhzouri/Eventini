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
});
