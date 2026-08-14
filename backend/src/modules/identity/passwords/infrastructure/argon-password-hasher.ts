import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

import {
  PasswordHasher,
  type PasswordVerification,
} from '../domain/password-hasher';
import {
  PASSWORD_PROFILE_VERSION,
  buildArgon2Options,
  isStaleHash,
  type Argon2Options,
  type Argon2Settings,
} from './argon2-profile';

@Injectable()
export class ArgonPasswordHasher extends PasswordHasher {
  readonly version = PASSWORD_PROFILE_VERSION;

  private readonly options: Argon2Options;
  private decoyHash?: Promise<string>;

  constructor(settings: Argon2Settings) {
    super();
    this.options = buildArgon2Options(settings);
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, this.options);
  }

  async verify(
    encodedHash: string,
    password: string,
  ): Promise<PasswordVerification> {
    let valid: boolean;

    try {
      valid = await argon2.verify(encodedHash, password, this.options);
    } catch {
      // A malformed digest is a corrupt row, not a server fault.
      return { valid: false, needsRehash: false };
    }

    return {
      valid,
      needsRehash: valid && isStaleHash(encodedHash, this.options),
    };
  }

  async verifyDecoy(password: string): Promise<void> {
    await argon2.verify(await this.decoy(), password, this.options);
  }

  /** Built once, from a password nobody holds, and reused for every attempt. */
  private decoy(): Promise<string> {
    return (this.decoyHash ??= argon2.hash(
      randomBytes(32).toString('base64'),
      this.options,
    ));
  }
}
