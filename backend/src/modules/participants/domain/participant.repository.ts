import type { TenantContext } from '../../../common/types/tenant-context';
import type { ParticipantType } from '../../../infrastructure/database/enums';

export interface ParticipantProfile {
  readonly participantId: string;
  readonly organizationId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly participantType: string;
  readonly organizationName: string | null;
  readonly jobTitle: string | null;
  readonly country: string | null;
  readonly externalReference: string | null;
  readonly metadata: Record<string, unknown>;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /**
   * Other active participants of the organization sharing this one's
   * `dedup_fingerprint`. A signal for a human — never acted on by the system.
   */
  readonly possibleDuplicateCount: number;
}

export interface ParticipantDetail extends ParticipantProfile {
  /** At most `MAX_DUPLICATE_IDS`, oldest first. */
  readonly possibleDuplicateIds: readonly string[];
}

/** How many duplicate ids a single-participant read lists. */
export const MAX_DUPLICATE_IDS = 20;

export interface ParticipantValues {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly participantType: ParticipantType;
  readonly organizationName: string | null;
  readonly jobTitle: string | null;
  readonly country: string | null;
  readonly externalReference: string | null;
  readonly metadata: Record<string, unknown>;
}

export type ParticipantChanges = {
  -readonly [K in keyof ParticipantValues]?: ParticipantValues[K];
};

export interface ParticipantAuditFacts {
  readonly actorRole: string | null;
  readonly requestId: string | null;
  readonly ipAddress: string | null;
}

export type ParticipantSortField = 'createdAt' | 'lastName';

export interface ParticipantListQuery {
  readonly limit: number;
  readonly sortBy: ParticipantSortField;
  readonly sortOrder: 'asc' | 'desc';
  /** Already trimmed, 2 to 100 characters. */
  readonly search: string | null;
  readonly participantTypes: readonly ParticipantType[];
  /** The keyset of a verified cursor: sort value, then id. */
  readonly boundary: {
    readonly direction: 'after' | 'before';
    readonly key: readonly [string, string];
  } | null;
}

export interface ParticipantPage {
  readonly items: ParticipantProfile[];
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
}

export type ParticipantCreateFailure = 'EMAIL_TAKEN';

export type ParticipantUpdateFailure = 'NOT_FOUND' | 'CONFLICT' | 'EMAIL_TAKEN';

/**
 * `ALREADY_REMOVED` is a success to the caller — API_CONVENTIONS.md §5 makes
 * a repeated `DELETE` a `204` — but kept distinct here so a replay writes no
 * second audit entry for a deletion that happened once.
 */
export type ParticipantRemoval = 'REMOVED' | 'ALREADY_REMOVED' | 'NOT_FOUND';

export abstract class ParticipantRepository {
  abstract list(
    context: TenantContext,
    query: ParticipantListQuery,
  ): Promise<ParticipantPage>;

  abstract find(
    context: TenantContext,
    participantId: string,
  ): Promise<ParticipantDetail | null>;

  abstract create(
    context: TenantContext,
    input: ParticipantValues & {
      readonly participantId: string;
      readonly facts: ParticipantAuditFacts;
    },
  ): Promise<ParticipantDetail | ParticipantCreateFailure>;

  abstract update(
    context: TenantContext,
    participantId: string,
    expectedVersion: number,
    changes: ParticipantChanges,
    facts: ParticipantAuditFacts,
  ): Promise<ParticipantDetail | ParticipantUpdateFailure>;

  abstract remove(
    context: TenantContext,
    participantId: string,
    reason: string | null,
    facts: ParticipantAuditFacts,
  ): Promise<ParticipantRemoval>;
}
