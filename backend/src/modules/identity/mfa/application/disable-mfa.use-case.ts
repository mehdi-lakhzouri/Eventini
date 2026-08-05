import { Injectable } from '@nestjs/common';

import { MfaError } from '../domain/mfa.errors';
import { MfaRepository } from '../domain/mfa.repository';

@Injectable()
export class DisableMfaUseCase {
  constructor(private readonly methods: MfaRepository) {}

  /**
   * INV-11 is enforced by a database trigger, not here: a `SUPER_ADMIN`
   * losing their last active method is refused by PostgreSQL. Checking it in
   * application code as well would duplicate a rule that already cannot be
   * bypassed, and the two copies would drift.
   */
  async execute(input: { userId: string; methodId: string }): Promise<void> {
    const disabled = await this.methods.disable({
      userId: input.userId,
      methodId: input.methodId,
      now: new Date(),
    });

    if (!disabled) {
      throw new MfaError('NO_ACTIVE_METHOD');
    }
  }
}
