import { Injectable } from '@nestjs/common';

import type { SessionClientType } from '../../../../infrastructure/database/enums';
import { normalizeEmail } from '../../../../infrastructure/database/normalize-email';
import { LockoutStore } from '../../../rate-limiting';
import { MfaChallengeStore } from '../../mfa/domain/mfa-challenge.store';
import { PasswordHasher } from '../../passwords/domain/password-hasher';
/*
  🔴 Le chemin direct, pas le baril `../../security-events`.

  Le baril réexporte `security-events.module.ts`, que `AuthenticationModule`
  importe déjà. Passer par lui referme un cycle `authentication → security-events
  → authentication`, et sous les modules VM de Jest ce cycle **bloque** la
  résolution : `NestFactory.create` ne rend jamais la main et les 20 suites e2e
  échouent toutes en `Exceeded timeout of 5000 ms for a hook`, y compris celles
  qui ne touchent à rien de tout cela. En `ts-node` le même cycle passe
  inaperçu — l'application démarre en 443 ms — donc rien ne le signale avant
  l'e2e.

  C'est aussi la convention du dossier : `MfaChallengeStore` et `PasswordHasher`
  sont importés par chemin direct juste au-dessus, pour la même raison.
*/
import { SecurityEventRecorder } from '../../security-events/application/security-event-recorder.service';
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
    private readonly securityEvents: SecurityEventRecorder,
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
      /*
        🔴 Aucun événement de sécurité ici, et c'est délibéré.

        Un attaquant qui tient une paire verrouillée continue de frapper : une
        ligne par tentative ferait de `security_events` une amplification de
        son propre déni de service — il choisirait le volume d'écritures de
        notre base. Le verrou **est** la trace : `ACCOUNT_LOCKED` a été émis
        une fois, au franchissement du seuil, et il porte le compte d'échecs.

        Ce qu'on perd — savoir combien de temps l'attaquant a insisté — est
        déjà dans les logs d'accès HTTP et dans les compteurs du rate limiter,
        qui sont conçus pour du volume. Pas cette table.
      */
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
      const reason = candidate === null ? 'UNKNOWN_ACCOUNT' : 'NO_CREDENTIAL';

      await this.registerFailure(command, normalizedEmail, {
        reason,
        userId: candidate?.userId ?? null,
      });

      throw new AuthenticationError(reason);
    }

    const verification = await this.hasher.verify(
      candidate.passwordHash,
      command.password,
    );

    if (!verification.valid) {
      await this.registerFailure(command, normalizedEmail, {
        reason: 'BAD_PASSWORD',
        userId: candidate.userId,
      });
      throw new AuthenticationError('BAD_PASSWORD');
    }

    // A correct password ends the streak, whatever the ladder had reached.
    await this.lockouts.clear(command.ipAddress, normalizedEmail);

    // Step 9. Checked after the hash, not before: returning early for a
    // suspended account would make it answer faster than an active one.
    if (candidate.status !== 'ACTIVE') {
      /*
        Un mot de passe correct sur un compte désactivé. Le compteur d'échecs
        n'est pas incrémenté — le comportement existant, et il est correct :
        ce n'est pas une tentative de devinette. L'événement, lui, est émis,
        parce que quelqu'un détient un secret valide pour un compte fermé.
      */
      await this.securityEvents.record('LOGIN_FAILED', {
        ...requestFacts(command),
        reasonCode: 'USER_NOT_ACTIVE',
        userId: candidate.userId,
        metadata: { userStatus: candidate.status },
      });

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

      /*
        Le `challengeId` n'est pas un secret — il est renvoyé au client dans la
        réponse. Le code TOTP attendu, lui, n'existe nulle part côté serveur, et
        le secret qui le dérive ne sort jamais de sa couche.
      */
      await this.securityEvents.record('MFA_CHALLENGE_CREATED', {
        ...requestFacts(command),
        userId: candidate.userId,
        metadata: {
          challengeId: challenge.challengeId,
          clientType: command.clientType,
        },
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

    /*
      Émis **après** l'émission de la session, jamais avant. Un
      `LOGIN_SUCCEEDED` écrit en amont affirmerait une connexion que l'insertion
      de la session peut encore faire échouer — et une table qui enregistre des
      connexions qui n'ont pas eu lieu est pire qu'inutile pour qui enquête.
    */
    await this.securityEvents.record('LOGIN_SUCCEEDED', {
      ...requestFacts(command),
      userId: candidate.userId,
      sessionId: session.sessionId,
      metadata: {
        clientType: command.clientType,
        authenticationLevel: 'PASSWORD',
      },
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
    command: LoginCommand,
    normalizedEmail: string,
    failure: { reason: string; userId: string | null },
  ): Promise<void> {
    const ladder = await this.lockouts.registerFailure(
      command.ipAddress,
      normalizedEmail,
    );
    const emailFailures =
      await this.lockouts.countEmailFailure(normalizedEmail);

    const facts = requestFacts(command);

    await this.securityEvents.record('LOGIN_FAILED', {
      ...facts,
      reasonCode: failure.reason,
      userId: failure.userId,
      metadata: {
        /*
          L'adresse visée, normalisée. Sans elle, un `LOGIN_FAILED` contre un
          compte inexistant n'a aucun acteur — ni `user_id`, ni `session_id` —
          et ne répond donc pas à la seule question qu'on lui posera : « qui
          était visé ». C'est aussi ce qui rend lisible la détection que §5.2
          décrit, la tentative distribuée contre un seul compte.

          Ce n'est pas un secret au sens de §8 : rien de ce qui y figure — mot
          de passe, jetons, secret MFA, codes de récupération — n'est ici.
        */
        attemptedEmail: normalizedEmail,
        clientType: command.clientType,
        ladderAttempts: ladder.attempts,
        emailFailuresLastHour: emailFailures,
      },
    });

    /*
      🔴 Le franchissement du seuil, émis **une seule fois**.

      `registerFailure` renvoie l'état d'après la tentative : `locked` n'est
      vrai que sur celle qui verrouille. Les suivantes ressortent en amont, sur
      le `isLocked` en tête d'`execute`, qui n'émet rien — c'est ce qui empêche
      un attaquant de choisir notre volume d'écritures.
    */
    if (ladder.locked) {
      await this.securityEvents.record('ACCOUNT_LOCKED', {
        ...facts,
        reasonCode: 'LOCKOUT_THRESHOLD_REACHED',
        userId: failure.userId,
        metadata: {
          attemptedEmail: normalizedEmail,
          ladderAttempts: ladder.attempts,
        },
      });
    }
  }
}

/**
 * Ce que la requête apporte et que le domaine ne porte pas.
 *
 * `traceId` reste absent : le contexte de trace n'est pas propagé jusqu'ici, et
 * mettre `null` explicitement vaut mieux que d'inventer une corrélation qui
 * n'existe pas. `request_id` suffit à rejoindre la ligne de log.
 */
function requestFacts(command: LoginCommand): {
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
} {
  return {
    requestId: command.requestId,
    ipAddress: command.ipAddress,
    userAgent: command.userAgent,
  };
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
