import {
  IsDateString,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsTimeZone,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CreateEventDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsString()
  @Length(3, 100)
  @Matches(SLUG_PATTERN, {
    message:
      'slug must contain only lowercase letters, digits and single hyphens, and must not start or end with one',
  })
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string | null;

  @IsString()
  @IsTimeZone()
  timezone!: string;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsOptional()
  @IsDateString()
  checkInOpensAt?: string | null;

  @IsOptional()
  @IsDateString()
  checkInClosesAt?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  locationName?: string | null;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

export class UpdateEventDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(3, 100)
  @Matches(SLUG_PATTERN, {
    message:
      'slug must contain only lowercase letters, digits and single hyphens, and must not start or end with one',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @IsTimeZone()
  timezone?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsDateString()
  checkInOpensAt?: string | null;

  @IsOptional()
  @IsDateString()
  checkInClosesAt?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  locationName?: string | null;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
