import { IsString, Length, Matches } from 'class-validator';

export class CancelEventDto {
  @IsString()
  @Length(1, 1_000)
  @Matches(/\S/, { message: 'reason must contain a non-whitespace character' })
  reason!: string;
}
