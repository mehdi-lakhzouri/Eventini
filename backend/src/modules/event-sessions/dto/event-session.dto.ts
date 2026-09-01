import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from 'class-validator';

import { EVENT_SESSION_TYPES } from '../../../infrastructure/database/enums';

export class CreateEventSessionDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsString()
  @IsIn(EVENT_SESSION_TYPES)
  sessionType!: string;

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
  @IsBoolean()
  requiresSeparateCheckIn?: boolean;
}

export class UpdateEventSessionDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn(EVENT_SESSION_TYPES)
  sessionType?: string;

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
  @IsBoolean()
  requiresSeparateCheckIn?: boolean;
}
