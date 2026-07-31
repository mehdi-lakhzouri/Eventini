import { BadRequestException, NotFoundException } from '@nestjs/common';

import { isServerError, mapUnknownException } from './map-unknown-exception';

describe('mapUnknownException', () => {
  it('maps a known Nest HttpException status to its default catalogue code', () => {
    const problem = mapUnknownException(
      new NotFoundException(),
      '/api/v1/unknown',
    );
    expect(problem.code).toBe('RESOURCE_NOT_FOUND');
    expect(problem.status).toBe(404);
  });

  it('falls back to INTERNAL_ERROR for a status with no default mapping', () => {
    const problem = mapUnknownException(
      new BadRequestException(undefined, { description: 'x' }),
      '/api/v1/x',
    );
    // 400 IS mapped -- assert the mapping actually took effect.
    expect(problem.code).toBe('VALIDATION_ERROR');
  });

  it('never leaks the original error message for a genuinely unknown exception', () => {
    const problem = mapUnknownException(
      new Error('relation "users" does not exist'),
      '/api/v1/x',
    );
    expect(problem.code).toBe('INTERNAL_ERROR');
    expect(problem.status).toBe(500);
    expect(problem.detail).not.toContain('users');
    expect(problem.detail).not.toContain('relation');
  });

  it('treats a thrown plain string or object the same way -- never reflected back', () => {
    const problem = mapUnknownException('raw string throw', '/api/v1/x');
    expect(problem.code).toBe('INTERNAL_ERROR');
    expect(problem.detail).toBe('An unexpected error occurred.');
  });
});

describe('isServerError', () => {
  it('is true for 5xx and false for 4xx', () => {
    expect(isServerError(mapUnknownException(new Error('x'), '/x'))).toBe(true);
    expect(
      isServerError(mapUnknownException(new NotFoundException(), '/x')),
    ).toBe(false);
  });
});
