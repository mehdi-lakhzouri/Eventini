import type {
  AuthenticationLevel,
  SessionClientType,
} from '../../../../infrastructure/database/enums';

export interface RotationRecord {
  readonly rotationId: string;
  readonly status: string;
  readonly tokenFamilyId: string;
  readonly expiresAt: Date;
  readonly session: {
    readonly sessionId: string;
    readonly userId: string;
    /** Read fresh, so a revocation that bumped it lands on this rotation. */
    readonly userVersion: number;
    /** Decides the lifetime profile, exactly as it did at login. */
    readonly hasPlatformRole: boolean;
    readonly organizationId: string | null;
    readonly membershipId: string | null;
    readonly clientType: SessionClientType;
    readonly authenticationLevel: AuthenticationLevel;
    readonly status: string;
    readonly idleExpiresAt: Date;
    readonly absoluteExpiresAt: Date;
  };
}

export interface RotationOutcome {
  readonly rotationId: string;
}

/** Thrown when `ux_refresh_active_per_family` refuses a second ACTIVE row. */
export class RotationConflictError extends Error {
  constructor() {
    super('Another rotation already consumed this token family');
    this.name = 'RotationConflictError';
  }
}

export abstract class RotationRepository {
  abstract findByTokenHash(tokenHash: string): Promise<RotationRecord | null>;

  /**
   * Consumes the presented token and issues its successor, in one
   * transaction. Throws `RotationConflictError` when a concurrent rotation
   * won — the partial unique index decides, not a lock.
   */
  abstract rotate(input: {
    readonly currentRotationId: string;
    readonly sessionId: string;
    readonly tokenFamilyId: string;
    readonly nextTokenHash: string;
    readonly nextExpiresAt: Date;
    readonly idleExpiresAt: Date;
    readonly now: Date;
  }): Promise<RotationOutcome>;

  /**
   * The replay procedure of §5.3, in one transaction: the presented row
   * becomes REUSED, the whole family is revoked, and the session is marked
   * COMPROMISED. No token is issued.
   */
  abstract recordReuse(input: {
    readonly rotationId: string;
    readonly sessionId: string;
    readonly tokenFamilyId: string;
    readonly now: Date;
  }): Promise<void>;
}
