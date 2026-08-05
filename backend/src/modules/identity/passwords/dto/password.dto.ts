import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RequestPasswordResetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(320)
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  currentPassword!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  newPassword!: string;
}
