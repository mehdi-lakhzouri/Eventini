import { AppException } from './app-exception';

describe('AppException', () => {
  it('carries the catalogue status as its HTTP status', () => {
    const exception = new AppException('AUTH_TENANT_DENIED');
    expect(exception.getStatus()).toBe(403);
    expect(exception.code).toBe('AUTH_TENANT_DENIED');
  });

  it('defaults detail to the catalogue title, errors to empty, retryable to false', () => {
    const exception = new AppException('RESOURCE_NOT_FOUND');
    expect(exception.detail).toBe('Resource not found');
    expect(exception.errors).toEqual([]);
    expect(exception.retryable).toBe(false);
  });

  it('accepts a custom detail, field errors, and retryable', () => {
    const exception = new AppException('VALIDATION_ERROR', {
      detail: 'One or more fields are invalid.',
      errors: [{ field: 'startsAt', code: 'REQUIRED', message: 'required' }],
      retryable: true,
    });
    expect(exception.detail).toBe('One or more fields are invalid.');
    expect(exception.errors).toHaveLength(1);
    expect(exception.retryable).toBe(true);
  });
});
