import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsISO31661Alpha2,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { CursorPaginationQueryDto } from '../../../common/api/pagination';
import {
  PARTICIPANT_TYPES,
  type ParticipantType,
} from '../../../infrastructure/database/enums';
import type { ParticipantSortField } from '../domain/participant.repository';

/** E.164: a plus, a non-zero country digit, at most fifteen digits in all. */
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
const NOT_BLANK = /\S/;

const NAME_MAX = 100;
const EMAIL_MAX = 254;
const LABEL_MAX = 200;

export const PARTICIPANT_SORT_FIELDS = [
  'createdAt',
  'lastName',
] as const satisfies readonly ParticipantSortField[];

/**
 * Optional fields accept `null` on purpose — it is how a caller clears one.
 * The non-nullable ones (`firstName`, `lastName`, `participantType`) use
 * `ValidateIf(value !== undefined)` in the update DTO instead of
 * `IsOptional`, which would let an explicit `null` through to a NOT NULL
 * column and turn a client mistake into a `500`.
 */
export class CreateParticipantDto {
  @IsString()
  @Length(1, NAME_MAX)
  @Matches(NOT_BLANK, { message: 'firstName must not be blank' })
  firstName!: string;

  @IsString()
  @Length(1, NAME_MAX)
  @Matches(NOT_BLANK, { message: 'lastName must not be blank' })
  lastName!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(EMAIL_MAX)
  email?: string | null;

  @IsOptional()
  @Matches(E164_PATTERN, {
    message: 'phone must be an E.164 number, such as +21620123456',
  })
  phone?: string | null;

  @IsOptional()
  @IsIn(PARTICIPANT_TYPES)
  participantType?: ParticipantType;

  @IsOptional()
  @IsString()
  @MaxLength(LABEL_MAX)
  organizationName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(LABEL_MAX)
  jobTitle?: string | null;

  @IsOptional()
  @IsISO31661Alpha2()
  country?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(LABEL_MAX)
  externalReference?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateParticipantDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, NAME_MAX)
  @Matches(NOT_BLANK, { message: 'firstName must not be blank' })
  firstName?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, NAME_MAX)
  @Matches(NOT_BLANK, { message: 'lastName must not be blank' })
  lastName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(EMAIL_MAX)
  email?: string | null;

  @IsOptional()
  @Matches(E164_PATTERN, {
    message: 'phone must be an E.164 number, such as +21620123456',
  })
  phone?: string | null;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(PARTICIPANT_TYPES)
  participantType?: ParticipantType;

  @IsOptional()
  @IsString()
  @MaxLength(LABEL_MAX)
  organizationName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(LABEL_MAX)
  jobTitle?: string | null;

  @IsOptional()
  @IsISO31661Alpha2()
  country?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(LABEL_MAX)
  externalReference?: string | null;

  @ValidateIf((_, value) => value !== undefined)
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class DeleteParticipantDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}

/** A repeated query parameter arrives as an array, a single one as a string. */
function toArray({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? [value] : value;
}

function trimmed({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * `GET /participants` — API_CONVENTIONS.md §6-7.
 *
 * `search` is bounded at both ends: under two characters it matches nearly
 * every row, and an unbounded pattern is an expensive query handed to anyone
 * holding `participants.read`. It is trimmed first, so `"  "` is too short
 * rather than a search for whitespace.
 */
export class ListParticipantsQueryDto extends CursorPaginationQueryDto {
  @IsOptional()
  @IsIn(PARTICIPANT_SORT_FIELDS)
  sortBy?: ParticipantSortField;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(2, 100)
  search?: string;

  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @ArrayMaxSize(PARTICIPANT_TYPES.length)
  @IsIn(PARTICIPANT_TYPES, { each: true })
  participantType?: ParticipantType[];
}
