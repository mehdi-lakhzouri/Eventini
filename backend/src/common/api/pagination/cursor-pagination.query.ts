import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { MAX_CURSOR_LENGTH } from './cursor';

/** API_CONVENTIONS.md §6. */
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/**
 * Query strings arrive as strings, and implicit conversion is off globally
 * (`buildValidationPipe`). Only a plain run of digits becomes a number, so
 * `"1e3"`, `"0x10"` and `" 5"` stay strings and fail `@IsInt` instead of
 * being quietly read as something the caller did not write.
 */
function toInteger({ value }: { value: unknown }): unknown {
  return typeof value === 'string' && /^\d{1,6}$/.test(value)
    ? Number(value)
    : value;
}

/**
 * The paging parameters every cursor-paginated list accepts.
 *
 * `limit=5000` is a `400`, not silently clamped to 100 — API_CONVENTIONS.md
 * §13 allows either, and a refusal is the one a client cannot mistake for
 * having received everything it asked for.
 *
 * `after` and `before` being mutually exclusive is checked by the handler: a
 * class-level rule would report on neither field, and the caller needs to know
 * which pair it sent.
 */
export class CursorPaginationQueryDto {
  @IsOptional()
  @Transform(toInteger)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_CURSOR_LENGTH)
  after?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_CURSOR_LENGTH)
  before?: string;
}
