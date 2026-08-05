import { parseStoredResponse } from './stored-response';

describe('parseStoredResponse', () => {
  it('reads a stored success', () => {
    expect(
      parseStoredResponse({
        kind: 'SUCCESS',
        requestId: 'req_01',
        data: { id: 'att_01' },
      }),
    ).toEqual({
      kind: 'SUCCESS',
      requestId: 'req_01',
      data: { id: 'att_01' },
    });
  });

  it('reads a stored failure', () => {
    expect(
      parseStoredResponse({
        kind: 'FAILURE',
        requestId: 'req_01',
        code: 'EVENT_NOT_ACTIVE',
        detail: 'nope',
        errors: [],
        retryable: false,
        extensions: { hint: 'x' },
      }),
    ).toEqual({
      kind: 'FAILURE',
      requestId: 'req_01',
      code: 'EVENT_NOT_ACTIVE',
      detail: 'nope',
      errors: [],
      retryable: false,
      extensions: { hint: 'x' },
    });
  });

  /**
   * A code that is no longer in the catalogue would build an `AppException`
   * that cannot resolve its own status. Refusing the record makes the request
   * re-execute, which is recoverable; accepting it would be a 500 on every
   * replay of that key until it expires.
   */
  it('refuses a code the catalogue does not have', () => {
    expect(
      parseStoredResponse({
        kind: 'FAILURE',
        requestId: 'req_01',
        code: 'RETIRED_CODE',
      }),
    ).toBeNull();
  });

  it.each([
    ['null', null],
    ['a scalar', 'text'],
    ['an unknown kind', { kind: 'OTHER', requestId: 'req_01' }],
    ['a record with no request id', { kind: 'SUCCESS', data: 1 }],
  ])('returns null for %s', (_label, value) => {
    expect(parseStoredResponse(value)).toBeNull();
  });

  /** JSONB round-trips `undefined` fields away; the parse must survive that. */
  it('fills in what a partially written failure lacks', () => {
    expect(
      parseStoredResponse({
        kind: 'FAILURE',
        requestId: 'req_01',
        code: 'EVENT_NOT_ACTIVE',
      }),
    ).toEqual({
      kind: 'FAILURE',
      requestId: 'req_01',
      code: 'EVENT_NOT_ACTIVE',
      detail: 'Event not active',
      errors: [],
      retryable: false,
      extensions: {},
    });
  });
});
