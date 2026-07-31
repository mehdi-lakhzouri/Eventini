import {
  serializeError,
  serializeRequest,
  serializeResponse,
  truncateIp,
} from './log-serializers';

describe('serializeRequest', () => {
  const request = {
    id: 'req_1',
    method: 'POST',
    originalUrl: '/api/v1/auth/sessions?token=RESET_TOKEN_SECRET',
    route: { path: '/auth/sessions' },
    ip: '197.0.55.12',
    headers: {
      authorization: 'Bearer SUPER_SECRET',
      cookie: 'session=SECRET_COOKIE',
      'x-api-key': 'KEY_SECRET',
      'content-type': 'application/json',
      'user-agent': 'jest',
      'x-request-id': 'req_1',
    },
  };

  it('keeps the identifier, method and matched route template', () => {
    const serialized = serializeRequest(request);

    expect(serialized.id).toBe('req_1');
    expect(serialized.method).toBe('POST');
    expect(serialized.route).toBe('/auth/sessions');
  });

  it('strips the query string, which routinely carries one-time tokens', () => {
    const serialized = serializeRequest(request);

    expect(serialized.path).toBe('/api/v1/auth/sessions');
    expect(JSON.stringify(serialized)).not.toContain('RESET_TOKEN_SECRET');
  });

  it('emits only allowlisted headers, dropping every credential-bearing one', () => {
    const serialized = serializeRequest(request);
    const asText = JSON.stringify(serialized);

    expect(asText).not.toContain('SUPER_SECRET');
    expect(asText).not.toContain('SECRET_COOKIE');
    expect(asText).not.toContain('KEY_SECRET');
    expect(serialized.headers).toEqual({
      'content-type': 'application/json',
      'user-agent': 'jest',
      'x-request-id': 'req_1',
    });
  });

  it('truncates the client IP', () => {
    expect(serializeRequest(request).remoteAddress).toBe('197.0.x.x');
  });

  it('never carries a request body, whatever is attached to the request', () => {
    const withBody = {
      ...request,
      body: { password: 'hunter2' },
    } as unknown as Parameters<typeof serializeRequest>[0];

    expect(JSON.stringify(serializeRequest(withBody))).not.toContain('hunter2');
  });
});

describe('truncateIp', () => {
  it.each([
    ['197.0.55.12', '197.0.x.x'],
    ['10.1.2.3', '10.1.x.x'],
  ])('truncates IPv4 %s to %s', (input, expected) => {
    expect(truncateIp(input)).toBe(expected);
  });

  it('truncates IPv6 to its first block', () => {
    expect(truncateIp('2001:db8::1')).toBe('2001:x:x:x');
  });

  it.each([undefined, '', 'not-an-ip'])('returns undefined for %s', (input) => {
    expect(truncateIp(input)).toBeUndefined();
  });
});

describe('serializeResponse', () => {
  it('emits the status and nothing else', () => {
    expect(serializeResponse({ statusCode: 204 })).toEqual({ statusCode: 204 });
  });

  it('never carries Set-Cookie', () => {
    const withHeaders = {
      statusCode: 200,
      getHeaders: () => ({ 'set-cookie': 'session=SECRET' }),
    } as unknown as Parameters<typeof serializeResponse>[0];

    expect(JSON.stringify(serializeResponse(withHeaders))).not.toContain(
      'SECRET',
    );
  });
});

describe('serializeError', () => {
  it('emits type, message and stack for a real Error', () => {
    const error = new TypeError('boom');
    const serialized = serializeError(error);

    expect(serialized.type).toBe('TypeError');
    expect(serialized.message).toBe('boom');
    expect(typeof serialized.stack).toBe('string');
  });

  it('handles a thrown non-Error without losing the value', () => {
    expect(serializeError('plain string throw')).toEqual({
      type: 'NonError',
      message: 'plain string throw',
    });
  });
});
