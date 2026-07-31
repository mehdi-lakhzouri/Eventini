import type { ValidationError } from 'class-validator';

import { mapValidationErrorCode } from './map-validation-error-code';
import type { FieldError } from './problem-details.types';

/**
 * `class-validator` nests errors by DTO structure (`children`) and groups
 * every failing rule for one property into a single `constraints` map. The
 * envelope wants a flat list, one entry per failing rule, with a dotted
 * path for nested properties — `address.postalCode`, not a `children` tree
 * the frontend would have to walk itself.
 */
export function flattenValidationErrors(
  errors: readonly ValidationError[],
  parentPath = '',
): FieldError[] {
  return errors.flatMap((error) => {
    const path = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;

    const ownErrors = Object.entries(error.constraints ?? {}).map(
      ([constraint, message]): FieldError => ({
        field: path,
        code: mapValidationErrorCode(constraint),
        message,
      }),
    );

    const childErrors = error.children?.length
      ? flattenValidationErrors(error.children, path)
      : [];

    return [...ownErrors, ...childErrors];
  });
}
