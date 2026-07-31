import { NotFoundException, type ArgumentsHost } from '@nestjs/common';

import { AppException } from './app-exception';
import { HttpExceptionFilter } from './http-exception.filter';

function makeHost(request: {
  method: string;
  originalUrl: string;
  id: string;
}): {
  host: ArgumentsHost;
  response: { status: jest.Mock; contentType: jest.Mock; json: jest.Mock };
} {
  const response = {
    status: jest.fn().mockReturnThis(),
    contentType: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  it('renders an AppException as RFC 9457 problem+json with its own code', () => {
    const { host, response } = makeHost({
      method: 'GET',
      originalUrl: '/api/v1/events/evt_1',
      id: 'req_1',
    });

    filter.catch(new AppException('AUTH_TENANT_DENIED'), host);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.contentType).toHaveBeenCalledWith(
      'application/problem+json',
    );
    const [envelope] = response.json.mock.calls[0] as [
      {
        data: null;
        error: { code: string; status: number };
        meta: { requestId: string };
      },
    ];
    expect(envelope.data).toBeNull();
    expect(envelope.error.code).toBe('AUTH_TENANT_DENIED');
    expect(envelope.error.status).toBe(403);
    expect(envelope.meta.requestId).toBe('req_1');
  });

  it('maps a bare Nest HttpException through the default-status table', () => {
    const { host, response } = makeHost({
      method: 'GET',
      originalUrl: '/api/v1/unknown',
      id: 'req_2',
    });

    filter.catch(new NotFoundException(), host);

    const [envelope] = response.json.mock.calls[0] as [
      { error: { code: string } },
    ];
    expect(envelope.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('never leaks the message of an unknown thrown error into the response', () => {
    const { host, response } = makeHost({
      method: 'GET',
      originalUrl: '/api/v1/x',
      id: 'req_3',
    });

    filter.catch(new Error('relation "users" does not exist'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    const [envelope] = response.json.mock.calls[0] as [
      { error: { detail: string } },
    ];
    expect(envelope.error.detail).toBe('An unexpected error occurred.');
  });
});
