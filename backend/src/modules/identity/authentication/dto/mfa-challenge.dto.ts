import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * One field, and deliberately untyped beyond a bounded string.
 *
 * A TOTP code and a recovery code have different shapes, and validating either
 * one here would tell the caller which kind the server was expecting — and, on
 * a rejection, which kind it had just failed at. The use case tries both and
 * answers the same way for either.
 */
export class VerifyMfaChallengeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;
}
