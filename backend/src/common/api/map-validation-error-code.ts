/**
 * Buckets a `class-validator` constraint name into one of the small set of
 * field-error codes API_CONVENTIONS.md §3 shows (`REQUIRED`, `OUT_OF_RANGE`
 * — those are examples in the doc, not an exhaustive catalogue). A starter
 * set covering the constraints actually in use; anything unrecognised falls
 * back to `INVALID` rather than guessing.
 */
const REQUIRED_CONSTRAINTS = new Set([
  'isDefined',
  'isNotEmpty',
  'arrayNotEmpty',
]);

const RANGE_CONSTRAINTS = new Set([
  'min',
  'max',
  'minLength',
  'maxLength',
  'isPositive',
  'isNegative',
  'arrayMinSize',
  'arrayMaxSize',
  'isIn',
  'isNotIn',
]);

const FORMAT_CONSTRAINTS = new Set([
  'isString',
  'isNumber',
  'isInt',
  'isBoolean',
  'isEmail',
  'isUuid',
  'isEnum',
  'isArray',
  'isDate',
  'isDateString',
  'isUrl',
  'isPhoneNumber',
  'isDecimal',
  'isJSON',
  'matches',
]);

export function mapValidationErrorCode(constraint: string): string {
  if (REQUIRED_CONSTRAINTS.has(constraint)) {
    return 'REQUIRED';
  }
  if (RANGE_CONSTRAINTS.has(constraint)) {
    return 'OUT_OF_RANGE';
  }
  if (constraint === 'whitelistValidation') {
    return 'UNEXPECTED_FIELD';
  }
  if (FORMAT_CONSTRAINTS.has(constraint)) {
    return 'INVALID_FORMAT';
  }
  return 'INVALID';
}
