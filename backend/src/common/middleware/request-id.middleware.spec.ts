import {
  RequestIdMiddleware,
  REQUEST_ID_HEADER,
} from './request-id.middleware';
import type { RequestWithId } from '../types/request-with-id';

function makeRequest(headerValue: string | undefined): RequestWithId {
  const headers: Record<string, string> = {};
  if (headerValue !== undefined) {
    headers[REQUEST_ID_HEADER.toLowerCase()] = headerValue;
  }

  return {
    headers,
  } as unknown as RequestWithId;
}

function makeResponse(): { setHeader: jest.Mock } {
  return { setHeader: jest.fn() };
}

describe('RequestIdMiddleware', () => {
  const middleware = new RequestIdMiddleware();

  it('generates an ID when the client sends none', () => {
    const request = makeRequest(undefined);
    const response = makeResponse();
    const next = jest.fn();

    middleware.use(request, response as never, next);

    expect(request.id).toMatch(/^req_/);
    expect(response.setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      request.id,
    );
    expect(next).toHaveBeenCalled();
  });

  it('keeps a valid client-supplied ID', () => {
    const request = makeRequest('client-supplied-id-123');
    const response = makeResponse();

    middleware.use(request, response as never, jest.fn());

    expect(request.id).toBe('client-supplied-id-123');
  });

  it.each([
    ['too short', 'short'],
    ['contains CRLF', 'abc\r\ninjected: header'],
    ['contains whitespace', 'has space here'],
    ['too long', 'a'.repeat(200)],
  ])('replaces an invalid ID (%s)', (_label, invalid) => {
    const request = makeRequest(invalid);
    const response = makeResponse();

    middleware.use(request, response as never, jest.fn());

    expect(request.id).toMatch(/^req_/);
    expect(request.id).not.toBe(invalid);
  });
});
