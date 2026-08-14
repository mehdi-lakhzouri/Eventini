import { Injectable } from '@nestjs/common';

import {
  AuthenticationRepository,
  type CurrentUserProfile,
} from '../domain/authentication.repository';

/**
 * The read behind `GET /auth/me`.
 *
 * `null` is a real outcome, not a should-never-happen guard: `CallerResolver`
 * confirms the user was `ACTIVE` a query ago, but nothing stops the account
 * from being deleted in between. The controller decides what a caller with no
 * profile left is told; this use case just reports it.
 */
@Injectable()
export class GetCurrentUserUseCase {
  constructor(private readonly users: AuthenticationRepository) {}

  async execute(userId: string): Promise<CurrentUserProfile | null> {
    return this.users.findProfileById(userId);
  }
}
