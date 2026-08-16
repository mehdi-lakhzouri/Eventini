import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { authenticationConfig } from '../../../../config/authentication.config';
import {
  hashRefreshToken,
  issueRefreshToken,
} from '../../sessions/domain/refresh-token';
import {
  RotationConflictError,
  RotationRepository,
} from '../../sessions/domain/rotation.repository';
import {
  deadlinesFor,
  profileFor,
} from '../../sessions/domain/session-profile';
import { sessionUnusableReason } from '../../sessions/domain/session-state';
// Chemin direct et non le baril : voir la note dans `login.use-case.ts`, le
// baril referme un cycle qui bloque le démarrage sous Jest.
import { SecurityEventRecorder } from '../../security-events/application/security-event-recorder.service';
import { RotationError } from '../domain/rotation.errors';
import { accessTokenTtlSeconds } from '../infrastructure/jwt/access-token.lifetime';
import { AccessTokenSigner } from '../infrastructure/jwt/access-token.signer';

/**
 * Ce que la requête apporte. Séparé du jeton présenté parce que ce sont deux
 * natures : l'un est le secret à vérifier, l'autre le contexte à enregistrer.
 */
export interface RotationFacts {
  readonly requestId: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export interface RefreshResult {
  readonly sessionId: string;
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
}

@Injectable()
export class RefreshSessionUseCase {
  constructor(
    private readonly rotations: RotationRepository,
    private readonly signer: AccessTokenSigner,
    @Inject(authenticationConfig.KEY)
    private readonly config: ConfigType<typeof authenticationConfig>,
    private readonly securityEvents: SecurityEventRecorder,
  ) {}

  async execute(
    presentedToken: string,
    facts: RotationFacts = {
      requestId: null,
      ipAddress: null,
      userAgent: null,
    },
  ): Promise<RefreshResult> {
    const tokenHash = hashRefreshToken(
      presentedToken,
      this.config.refreshToken.hmacSecret,
    );
    const current = await this.rotations.findByTokenHash(tokenHash);

    if (current === null) {
      throw new RotationError('UNKNOWN_TOKEN');
    }

    const now = new Date();

    // §5.3. A row that is not ACTIVE means this token was already spent, so
    // someone is holding a copy. Which of the two is legitimate is unknowable,
    // so the whole family falls and neither keeps access.
    if (current.status !== 'ACTIVE') {
      await this.rotations.recordReuse({
        rotationId: current.rotationId,
        sessionId: current.session.sessionId,
        tokenFamilyId: current.tokenFamilyId,
        now,
      });

      /*
        🔴 Après `recordReuse`, jamais dedans.

        `recordReuse` fait tomber toute la famille dans une transaction. Écrire
        l'événement à l'intérieur le ferait disparaître avec un rollback —
        c'est-à-dire précisément dans le cas où l'abattage de la famille a
        échoué et où quelqu'un doit être prévenu. Après le commit, l'événement
        décrit un fait acquis.

        Les deux événements les plus graves du système partent ici, ensemble :
        le rejeu constaté, et la session déclarée compromise. Ils sont distincts
        parce qu'ils répondent à deux questions — « ce jeton a été présenté deux
        fois » et « cette session ne vaut plus rien » — et qu'une alerte peut
        vouloir l'une sans l'autre.
      */
      const reuseFacts = {
        ...facts,
        userId: current.session.userId,
        sessionId: current.session.sessionId,
        organizationId: current.session.organizationId,
        membershipId: current.session.membershipId,
        reasonCode: 'ROTATED_TOKEN_REPLAYED',
        metadata: {
          tokenFamilyId: current.tokenFamilyId,
          rotationStatus: current.status,
          clientType: current.session.clientType,
        },
      };

      await this.securityEvents.record(
        'REFRESH_TOKEN_REUSE_DETECTED',
        reuseFacts,
      );
      await this.securityEvents.record('SESSION_COMPROMISED', reuseFacts);

      throw new RotationError('REUSE_DETECTED');
    }

    if (current.expiresAt.getTime() <= now.getTime()) {
      throw new RotationError('TOKEN_EXPIRED');
    }

    const unusable = sessionUnusableReason(current.session, now);

    if (unusable !== null) {
      throw new RotationError(
        unusable === 'NOT_ACTIVE'
          ? 'SESSION_REVOKED'
          : unusable === 'IDLE_EXPIRED'
            ? 'SESSION_IDLE_EXPIRED'
            : 'SESSION_ABSOLUTE_EXPIRED',
      );
    }

    const profile = profileFor(
      current.session.clientType,
      current.session.hasPlatformRole,
    );
    const deadlines = deadlinesFor(profile, this.config.lifetimes, now);
    const next = issueRefreshToken(this.config.refreshToken.hmacSecret);

    try {
      await this.rotations.rotate({
        currentRotationId: current.rotationId,
        sessionId: current.session.sessionId,
        tokenFamilyId: current.tokenFamilyId,
        nextTokenHash: next.tokenHash,
        nextExpiresAt: deadlines.refreshExpiresAt,
        // Only the idle deadline moves. The absolute one is what stops a
        // session living forever by being used forever.
        idleExpiresAt: deadlines.idleExpiresAt,
        now,
      });
    } catch (error: unknown) {
      if (error instanceof RotationConflictError) {
        throw new RotationError('CONCURRENT_ROTATION');
      }

      throw error;
    }

    const access = await this.signer.issue(
      {
        userId: current.session.userId,
        sessionId: current.session.sessionId,
        organizationId: current.session.organizationId,
        membershipId: current.session.membershipId,
        // Read fresh with the session, not carried over from the old token,
        // so a revocation that bumped it takes effect on this rotation.
        userVersion: current.session.userVersion,
        clientType: current.session.clientType,
        authLevel: current.session.authenticationLevel,
      },
      accessTokenTtlSeconds(
        current.session.clientType,
        current.session.hasPlatformRole,
        this.config.lifetimes.accessToken,
      ),
    );

    /*
      🔴 Pas de `SESSION_REFRESHED` ici, et c'est un choix, pas un oubli.

      Il serait le plus gros contributeur en lignes de toute la table — une par
      session active toutes les dix minutes, soit des dizaines de millions par
      an sur douze mois de rétention — pour dupliquer ce que
      `refresh_token_rotations` enregistre déjà, et mieux : cette table porte la
      chaîne complète (`previous_token_id`, `replaced_by_token_id`,
      `consumed_at`), pas seulement l'horodatage.

      Le catalogue de §8 liste le type, donc il reste disponible ; ce qui manque
      pour l'émettre n'est pas le code mais une raison. Voir la note du ticket.
    */
    return {
      sessionId: current.session.sessionId,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: next.token,
      refreshTokenExpiresAt: deadlines.refreshExpiresAt,
    };
  }
}
