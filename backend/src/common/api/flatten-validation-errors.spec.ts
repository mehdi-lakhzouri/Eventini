import type { ValidationError } from 'class-validator';

import { flattenValidationErrors } from './flatten-validation-errors';

describe('flattenValidationErrors', () => {
  it('produces one FieldError per failing constraint', () => {
    const errors: ValidationError[] = [
      {
        property: 'startsAt',
        constraints: { isNotEmpty: 'startsAt should not be empty' },
      },
      {
        property: 'capacity',
        constraints: {
          min: 'capacity must not be less than 1',
          max: 'capacity must not be greater than 100000',
        },
      },
    ];

    const flattened = flattenValidationErrors(errors);

    expect(flattened).toHaveLength(3);
    expect(flattened).toContainEqual({
      field: 'startsAt',
      code: 'REQUIRED',
      message: 'startsAt should not be empty',
    });
    expect(flattened.filter((e) => e.field === 'capacity')).toHaveLength(2);
  });

  it('builds a dotted path for nested DTO errors', () => {
    const errors: ValidationError[] = [
      {
        property: 'address',
        children: [
          {
            property: 'postalCode',
            constraints: { isNotEmpty: 'postalCode should not be empty' },
          },
        ],
      },
    ];

    const flattened = flattenValidationErrors(errors);

    expect(flattened).toEqual([
      {
        field: 'address.postalCode',
        code: 'REQUIRED',
        message: 'postalCode should not be empty',
      },
    ]);
  });
});
