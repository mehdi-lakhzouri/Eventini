import { Injectable } from '@nestjs/common';

import type { SessionClientType } from '../../../../infrastructure/database/enums';
import { normalizeEmail } from '../../../../infrastructure/database/normalize-email';
import { MfaChallengeStore } from '../../mfa/domain/mfa-challenge.store';
import { PasswordHasher } from '../../passwords/domain/password-hasher';
import { AuthenticationError } from '../domain/authentication.errors';
import { AuthenticationRepository } from '../domain/authentication.repository';
import { SessionIssuer, type IssuedSession } from './session-issuer';

export interface LoginCommand {
  readonly email: string;
  readonly password: string;
  readonly clientType: SessionClientType;
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
  readonly requestId: string | null;
}

export interface MfaRequired {
  readonly outcome: 'MFA_REQUIRED';
  readonly challengeId: string;
}

export type SessionEstablished = IssuedSession & {
  readonly outcome: 'SESSION_ESTABLISHED';
};

/**
 * A discriminated union rather than a session with nullable fields: it is not
 * possible to read a token off the MFA branch, because the branch has none.
 */
export type LoginResult = SessionEstablished | MfaRequired;

@Injectable()
export class LoginUseCase {
  constructor(
    private readonly users: AuthenticationRepository,
    private readonly hasher: PasswordHasher,
    private readonly challenges: MfaChallengeStore,
    private readonly issuer: SessionIssuer,
  ) {}

  async execute(command: LoginCommand): Promise<LoginResult> {
    const normalizedEmail = normalizeEmail(command.email);
    const candidate = await this.users.findCandidateByEmail(normalizedEmail);

    // Step 7. The verification runs whether or not the account exists, so the
    // response time does not disclose which addresses are registered. A
    // missing credential row takes the same path for the same reason.
    if (candidate === null || candidate.passwordHash === null) {
      await this.hasher.verifyDecoy(command.password);
      throw new AuthenticationError(
        candidate === null ? 'UNKNOWN_ACCOUNT' : 'NO_CREDENTIAL',
      );
    }

    const verification = await this.hasher.verify(
      candidate.passwordHash,
      command.password,
    );

    if (!verification.valid) {
      throw new AuthenticationError('BAD_PASSWORD');
    }

    // Step 9. Checked after the hash, not before: returning early for a
    // suspended account would make it answer faster than an active one.
    if (candidate.status !== 'ACTIVE') {
      throw new AuthenticationError('USER_NOT_ACTIVE');
    }

    // Step 10, and it sits ahead of every line that mints something. A correct
    // password alone buys a challenge id and nothing else: no session row, no
    // access token, no refresh token, no `last_login_at`. Ordering is the
    // whole control — anything issued here would already be in the client's
    // hands by the time the code was asked for.
    if (requiresMfa(candidate)) {
      const challenge = await this.challenges.create({
        userId: candidate.userId,
        clientType: command.clientType,
      });

      return { outcome: 'MFA_REQUIRED', challengeId: challenge.challengeId };
    }

    const session = await this.issuer.issue({
      candidate,
      clientType: command.clientType,
      authenticationLevel: 'PASSWORD',
      userAgent: command.userAgent,
      ipAddress: command.ipAddress,
      requestId: command.requestId,
    });

    return { outcome: 'SESSION_ESTABLISHED', ...session };
  }
}

/**
 * §5.1 step 10: an enrolled method, *or* the `SUPER_ADMIN` role.
 *
 * The second clause is redundant while INV-11 holds, since the trigger refuses
 * that role to a user without an ACTIVE method. It is written out anyway
 * because the two failure modes are not symmetric: if the invariant were ever
 * bypassed, gating on enrolment alone would let a platform administrator in on
 * a password, while gating on the role locks them out until MFA is restored.
 * Fail-closed is the correct side for that account.
 */
function requiresMfa(candidate: {
  hasActiveMfa: boolean;
  isSuperAdmin: boolean;
}): boolean {
  return candidate.hasActiveMfa || candidate.isSuperAdmin;
}
