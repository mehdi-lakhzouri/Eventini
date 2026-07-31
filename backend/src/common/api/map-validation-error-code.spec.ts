import { mapValidationErrorCode } from './map-validation-error-code';

describe('mapValidationErrorCode', () => {
  it.each([
    ['isNotEmpty', 'REQUIRED'],
    ['isDefined', 'REQUIRED'],
    ['min', 'OUT_OF_RANGE'],
    ['maxLength', 'OUT_OF_RANGE'],
    ['isEmail', 'INVALID_FORMAT'],
    ['isUuid', 'INVALID_FORMAT'],
    ['whitelistValidation', 'UNEXPECTED_FIELD'],
    ['someUnmappedConstraint', 'INVALID'],
  ])('maps %s to %s', (constraint, expected) => {
    expect(mapValidationErrorCode(constraint)).toBe(expected);
  });
});
