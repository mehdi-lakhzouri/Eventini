import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * The code from the authenticator app, proving the secret was actually
 * scanned before the method is allowed to guard anything.
 */
export class ConfirmMfaEnrollmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  code!: string;
}
