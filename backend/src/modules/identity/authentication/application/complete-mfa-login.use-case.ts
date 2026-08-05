import { Injectable } from '@nestjs/common';

import { MfaChallengeStore } from '../../mfa/domain/mfa-challenge.store';
import { VerifyMfaUseCase } from '../../mfa/application/verify-mfa.use-case';
import { AuthenticationError } from '../domain/authentication.errors';
import { AuthenticationRepository } from '../domain/authentication.repository';
import { SessionIssuer, type IssuedSession } from './session-issuer';

export interface CompleteMfaLoginCommand {
  readonly challengeId: string;
  readonly code: string;
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
  readonly requestId: string | null;
}

export interface CompletedMfaLogin {
  readonly session: IssuedSession;
  /** The client is told to print a fresh batch when the last code is spent. */
  readonly usedRecoveryCode: boolean;
}

/**
 * The second half of a gated login: the challenge is answered, and only now
 * does a session exist.
 *
 * The client type comes from the challenge rather than the request, so a
 * challenge opened by a scanner cannot be finished as a web session and
 * inherit the longer web lifetimes.
 */
@Injectable()
export class CompleteMfaLoginUseCase {
  constructor(
    private readonly verifier: VerifyMfaUseCase,
    private readonly challenges: MfaChallengeStore,
    private readonly users: AuthenticationRepository,
    private readonly issuer: SessionIssuer,
  ) {}

  async execute(command: CompleteMfaLoginCommand): Promise<CompletedMfaLogin> {
    const challenge = await this.challenges.find(command.challengeId);

    if (challenge === null) {
      throw new AuthenticationError('MFA_CHALLENGE_UNKNOWN');
    }

    // Throws on a bad code, and consumes the challenge on a good one.
    const verified = await this.verifier.execute({
      challengeId: command.challengeId,
      code: command.code,
    });

    // Re-read rather than trust the row loaded five minutes ago at password
    // time: suspension and revocation inside the challenge window must take
    // effect, and `users.version` may have moved under a global logout.
    const candidate = await this.users.findCandidateById(verified.userId);

    if (candidate === null || candidate.status !== 'ACTIVE') {
      throw new AuthenticationError('USER_NOT_ACTIVE');
    }

    const session = await this.issuer.issue({
      candidate,
      clientType: challenge.clientType,
      authenticationLevel: 'MFA',
      userAgent: command.userAgent,
      ipAddress: command.ipAddress,
      requestId: command.requestId,
    });

    return { session, usedRecoveryCode: verified.usedRecoveryCode };
  }
}
