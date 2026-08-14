import { buildProblemDetails } from './build-problem-details';

describe('buildProblemDetails', () => {
  it('fills type/title/status from the catalogue and instance from the argument', () => {
    const problem = buildProblemDetails(
      'AUTH_TENANT_DENIED',
      '/api/v1/events/evt_1',
    );

    expect(problem).toEqual({
      type: 'https://errors.eventini.com/tenant-access-denied',
      title: 'Tenant access denied',
      status: 403,
      code: 'AUTH_TENANT_DENIED',
      detail: 'Tenant access denied',
      instance: '/api/v1/events/evt_1',
      errors: [],
      retryable: false,
    });
  });

  it('applies overrides for detail, errors, and retryable', () => {
    const problem = buildProblemDetails('VALIDATION_ERROR', '/api/v1/events', {
      detail: 'custom detail',
      errors: [{ field: 'name', code: 'REQUIRED', message: 'required' }],
      retryable: true,
    });

    expect(problem.detail).toBe('custom detail');
    expect(problem.errors).toHaveLength(1);
    expect(problem.retryable).toBe(true);
  });
});
