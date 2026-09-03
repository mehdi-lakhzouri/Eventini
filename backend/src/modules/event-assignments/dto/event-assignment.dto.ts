import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { EVENT_ASSIGNMENT_TYPES } from '../../../infrastructure/database/enums';

export class CreateEventAssignmentDto {
  @IsString()
  @MaxLength(128)
  membershipId!: string;

  @IsIn(EVENT_ASSIGNMENT_TYPES)
  assignmentType!: (typeof EVENT_ASSIGNMENT_TYPES)[number];

  @IsOptional()
  @IsDateString()
  validFrom?: string | null;

  @IsOptional()
  @IsDateString()
  validUntil?: string | null;
}
