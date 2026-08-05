import { Injectable } from '@nestjs/common';

import type { SessionClientType } from '../../../../infrastructure/database/enums';
import { normalizeEmail } from '../../../../infrastructure/database/normalize-email';
import { LockoutStore } from '../../../rate-limiting';
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
    private readonly lockouts: LockoutStore,
  ) {}

  async execute(command: LoginCommand): Promise<LoginResult> {
    const normalizedEmail = normalizeEmail(command.email);

    // Step 4. Consulted before Argon2id is paid for: a locked pair should not
    // be able to spend 19 MiB and 60 ms of server time per attempt. The
    // refusal is `BAD_PASSWORD`, which the controller renders as the same
    // generic 401 as every other rejection — §5.3 forbids telling the caller
    // that a lockout exists, because that both confirms the account and tells
    // an attacker their denial of service worked.
    if (await this.lockouts.isLocked(command.ipAddress, normalizedEmail)) {
      throw new AuthenticationError('BAD_PASSWORD');
    }

    const candidate = await this.users.findCandidateByEmail(normalizedEmail);

    // Step 7. The verification runs whether or not the account exists, so the
    // response time does not disclose which addresses are registered. A
    // missing credential row takes the same path for the same reason.
    if (candidate === null || candidate.passwordHash === null) {
      await this.hasher.verifyDecoy(command.password);
      // Counted like any other failure. If only real accounts accumulated
      // failures, the presence or absence of a lockout would itself answer
      // "does this address exist?" — the question step 7's decoy hash is
      // spending time to avoid.
      await this.registerFailure(command.ipAddress, normalizedEmail);
      throw new AuthenticationError(
        candidate === null ? 'UNKNOWN_ACCOUNT' : 'NO_CREDENTIAL',
      );
    }

    const verification = await this.hasher.verify(
      candidate.passwordHash,
      command.password,
    );

    if (!verification.valid) {
      await this.registerFailure(command.ipAddress, normalizedEmail);
      throw new AuthenticationError('BAD_PASSWORD');
    }

    // A correct password ends the streak, whatever the ladder had reached.
    await this.lockouts.clear(command.ipAddress, normalizedEmail);

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

  /**
   * One failure, recorded on both counters — §5.2.
   *
   * The `ip+email` counter drives the ladder and can lock. The per-email
   * counter spans every address an attacker might use and **never locks**: it
   * exists so a distributed attempt against one account is visible, while the
   * account itself stays reachable by the person who owns it. Detection and
   * blocking are deliberately different mechanisms here.
   */
  private async registerFailure(
    ip: string | null,
    normalizedEmail: string,
  ): Promise<void> {
    await this.lockouts.registerFailure(ip, normalizedEmail);
    await this.lockouts.countEmailFailure(normalizedEmail);
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
