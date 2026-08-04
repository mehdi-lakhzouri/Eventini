import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { SESSION_CLIENT_TYPES } from '../../../../infrastructure/database/enums';

/**
 * Step 1. The global pipe runs with `whitelist` and `forbidNonWhitelisted`,
 * so anything not declared here is rejected rather than quietly dropped.
 *
 * The email is not validated with `@IsEmail`: a malformed address must fail
 * like a wrong password, not like a validation error, or the endpoint reports
 * which addresses are even shaped like accounts. It is normalized and looked
 * up, and it simply will not match.
 */
export class LoginRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(320)
  email!: string;

  @IsString()
  @IsNotEmpty()
  // Bounded to stop a megabyte of input reaching Argon2id. The password
  // policy's own 128-character limit is applied at registration, not here:
  // rejecting a long password at login would tell the caller their guess was
  // the wrong shape.
  @MaxLength(1024)
  password!: string;

  @IsIn(SESSION_CLIENT_TYPES)
  clientType!: (typeof SESSION_CLIENT_TYPES)[number];
}
