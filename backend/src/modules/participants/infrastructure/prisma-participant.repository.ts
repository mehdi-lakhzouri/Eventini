import { Inject, Injectable } from '@nestjs/common';

import { fetchOrder, toPageWindow } from '../../../common/api/pagination';
import type { TenantContext } from '../../../common/types/tenant-context';
import { escapeLikePattern } from '../../../infrastructure/database/like-pattern';
import { normalizeEmail } from '../../../infrastructure/database/normalize-email';
import { Prisma } from '../../../infrastructure/database/prisma/generated/client';
import { TENANT_SCOPED_PRISMA } from '../../../infrastructure/database/prisma.tokens';
import type { TenantScopedPrismaClient } from '../../../infrastructure/database/tenant-scope.extension';
import type { TransactionalClient } from '../../../infrastructure/database/transaction.manager';
import { AuditRecorder } from '../../audit';
import {
  normalizeParticipantEmail,
  participantFingerprint,
} from '../domain/participant-identity';
import {
  MAX_DUPLICATE_IDS,
  ParticipantRepository,
  type ParticipantAuditFacts,
  type ParticipantChanges,
  type ParticipantCreateFailure,
  type ParticipantDetail,
  type ParticipantListQuery,
  type ParticipantPage,
  type ParticipantProfile,
  type ParticipantRemoval,
  type ParticipantSortField,
  type ParticipantUpdateFailure,
  type ParticipantValues,
} from '../domain/participant.repository';

const UNIQUE_VIOLATION = 'P2002';

const PARTICIPANT_SELECT = {
  id: true,
  organizationId: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  participantType: true,
  organizationName: true,
  jobTitle: true,
  country: true,
  externalReference: true,
  metadata: true,
  dedupFingerprint: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;

type ParticipantRow = Prisma.ParticipantGetPayload<{
  select: typeof PARTICIPANT_SELECT;
}>;

/** Either the scoped client or a transaction opened on it. */
type ParticipantReader = Pick<TransactionalClient, 'participant'>;

/** The fields whose change moves a participant's `dedup_fingerprint`. */
const IDENTITY_FIELDS = ['firstName', 'lastName', 'email', 'phone'] as const;

/** Optional fields named — never their values — in a creation audit entry. */
const OPTIONAL_FIELDS = [
  'email',
  'phone',
  'organizationName',
  'jobTitle',
  'country',
  'externalReference',
] as const;

function metadataObject(value: Prisma.JsonValue): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value
    : {};
}

const toProfile = (
  row: ParticipantRow,
  possibleDuplicateCount: number,
): ParticipantProfile => ({
  participantId: row.id,
  organizationId: row.organizationId,
  firstName: row.firstName,
  lastName: row.lastName,
  email: row.email,
  phone: row.phone,
  participantType: row.participantType,
  organizationName: row.organizationName,
  jobTitle: row.jobTitle,
  country: row.country,
  externalReference: row.externalReference,
  metadata: metadataObject(row.metadata),
  version: row.version,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  possibleDuplicateCount,
});

/**
 * ## Personal data in the audit trail
 *
 * Audit entries name the fields that were set or changed, never their values
 * (PINO_LOGGING_SPECIFICATION.md §31: technical identifiers over personal
 * data). `audit_logs` is append-only and outlives the participant row's own
 * retention; a name or an email copied into it could never be erased with
 * the participant. `participant_type` is the exception — a category, not a
 * person — and is recorded as a value.
 */
@Injectable()
export class PrismaParticipantRepository extends ParticipantRepository {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA)
    private readonly prisma: TenantScopedPrismaClient,
    private readonly audit: AuditRecorder,
  ) {
    super();
  }

  /**
   * Keyset pagination over `(sortField, id)` — API_CONVENTIONS.md §6.
   *
   * `id` breaks ties, so rows sharing a `created_at` or a `last_name` are
   * neither repeated nor skipped across pages. `ix_participants_org_created`
   * and `ix_participants_org_lastname` carry the organization prefix and the
   * sort column; `id` is resolved from the heap on the tie rows only.
   *
   * `search` is a case-insensitive substring over the three whitelisted
   * fields. It is not index-assisted at MVP: its cost is bounded by the
   * organization prefix and by `limit + 1`, and the 2-character floor keeps
   * it from being a disguised full listing.
   */
  async list(
    context: TenantContext,
    query: ParticipantListQuery,
  ): Promise<ParticipantPage> {
    const direction = query.boundary?.direction ?? 'after';
    const order = fetchOrder(query.sortOrder, direction);

    const conditions: Prisma.ParticipantWhereInput[] = [];
    if (query.search !== null) {
      conditions.push(searchClause(query.search));
    }
    if (query.boundary !== null) {
      conditions.push(keysetClause(query.sortBy, order, query.boundary.key));
    }

    const rows = await this.prisma.participant.findMany({
      where: {
        organizationId: context.organizationId,
        deletedAt: null,
        ...(query.participantTypes.length === 0
          ? {}
          : { participantType: { in: [...query.participantTypes] } }),
        ...(conditions.length === 0 ? {} : { AND: conditions }),
      },
      select: PARTICIPANT_SELECT,
      orderBy:
        query.sortBy === 'createdAt'
          ? [{ createdAt: order }, { id: order }]
          : [{ lastName: order }, { id: order }],
      take: query.limit + 1,
    });

    const page = toPageWindow(
      rows,
      query.limit,
      direction,
      query.boundary !== null,
    );
    const duplicates = await this.duplicateCounts(context, page.items);

    return {
      items: page.items.map((row) =>
        toProfile(row, duplicates.get(row.dedupFingerprint) ?? 0),
      ),
      hasNextPage: page.hasNextPage,
      hasPreviousPage: page.hasPreviousPage,
    };
  }

  async find(
    context: TenantContext,
    participantId: string,
  ): Promise<ParticipantDetail | null> {
    const row = await this.prisma.participant.findFirst({
      where: {
        id: participantId,
        organizationId: context.organizationId,
        deletedAt: null,
      },
      select: PARTICIPANT_SELECT,
    });

    return row === null ? null : this.detail(this.prisma, context, row);
  }

  async create(
    context: TenantContext,
    input: ParticipantValues & {
      readonly participantId: string;
      readonly facts: ParticipantAuditFacts;
    },
  ): Promise<ParticipantDetail | ParticipantCreateFailure> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.participant.create({
          data: {
            id: input.participantId,
            organizationId: context.organizationId,
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email,
            normalizedEmail: normalizeParticipantEmail(input.email),
            phone: input.phone,
            participantType: input.participantType,
            organizationName: input.organizationName,
            jobTitle: input.jobTitle,
            country: input.country,
            externalReference: input.externalReference,
            metadata: input.metadata as Prisma.InputJsonValue,
            dedupFingerprint: participantFingerprint(input),
            createdBy: context.userId,
            updatedBy: context.userId,
          },
          select: PARTICIPANT_SELECT,
        });

        const detail = await this.detail(tx, context, row);

        await this.audit.record(
          tx,
          context,
          {
            action: 'participant.created',
            targetType: 'participant',
            targetId: row.id,
            newValues: {
              participantType: row.participantType,
              providedFields: OPTIONAL_FIELDS.filter(
                (field) => input[field] !== null,
              ),
              possibleDuplicateCount: detail.possibleDuplicateCount,
            },
          },
          input.facts,
        );

        return detail;
      });
    } catch (error: unknown) {
      // `ux_participants_org_email_active` is the table's only unique index
      // besides a UUIDv7 primary key, so a violation without an email cannot
      // be an address collision and is not reported as one.
      if (isUniqueViolation(error) && input.email !== null) {
        return 'EMAIL_TAKEN';
      }

      throw error;
    }
  }

  async update(
    context: TenantContext,
    participantId: string,
    expectedVersion: number,
    changes: ParticipantChanges,
    facts: ParticipantAuditFacts,
  ): Promise<ParticipantDetail | ParticipantUpdateFailure> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.participant.findFirst({
          where: {
            id: participantId,
            organizationId: context.organizationId,
            deletedAt: null,
          },
          select: PARTICIPANT_SELECT,
        });

        if (current === null) return 'NOT_FOUND';
        if (current.version !== expectedVersion) return 'CONFLICT';

        const { metadata, ...scalarChanges } = changes;
        const identityChanged = IDENTITY_FIELDS.some(
          (field) => changes[field] !== undefined,
        );

        const affected = await tx.participant.updateMany({
          where: {
            id: participantId,
            organizationId: context.organizationId,
            version: expectedVersion,
            deletedAt: null,
          },
          data: {
            ...scalarChanges,
            ...(metadata === undefined
              ? {}
              : { metadata: metadata as Prisma.InputJsonValue }),
            ...(changes.email === undefined
              ? {}
              : { normalizedEmail: normalizeParticipantEmail(changes.email) }),
            ...(identityChanged
              ? {
                  dedupFingerprint: participantFingerprint({
                    firstName: changes.firstName ?? current.firstName,
                    lastName: changes.lastName ?? current.lastName,
                    email:
                      changes.email === undefined
                        ? current.email
                        : changes.email,
                    phone:
                      changes.phone === undefined
                        ? current.phone
                        : changes.phone,
                  }),
                }
              : {}),
            version: { increment: 1 },
            updatedBy: context.userId,
          },
        });

        if (affected.count === 0) return 'CONFLICT';

        const updated = await tx.participant.findFirst({
          where: {
            id: participantId,
            organizationId: context.organizationId,
            deletedAt: null,
          },
          select: PARTICIPANT_SELECT,
        });

        if (updated === null) return 'NOT_FOUND';

        const typeChanged =
          changes.participantType !== undefined &&
          changes.participantType !== current.participantType;

        await this.audit.record(
          tx,
          context,
          {
            action: 'participant.updated',
            targetType: 'participant',
            targetId: participantId,
            previousValues: typeChanged
              ? { participantType: current.participantType }
              : null,
            newValues: {
              changedFields: Object.keys(changes).sort(),
              ...(typeChanged
                ? { participantType: updated.participantType }
                : {}),
            },
          },
          facts,
        );

        return this.detail(tx, context, updated);
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        return 'EMAIL_TAKEN';
      }

      throw error instanceof Error
        ? error
        : new Error('Participant update failed.', { cause: error });
    }
  }

  async remove(
    context: TenantContext,
    participantId: string,
    reason: string | null,
    facts: ParticipantAuditFacts,
  ): Promise<ParticipantRemoval> {
    return this.prisma.$transaction(async (tx) => {
      // Deliberately not filtered on `deleted_at`: a removed participant is
      // still found, so a repeated DELETE answers 204 rather than 404.
      const row = await tx.participant.findFirst({
        where: { id: participantId, organizationId: context.organizationId },
        select: { deletedAt: true },
      });

      if (row === null) return 'NOT_FOUND';
      if (row.deletedAt !== null) return 'ALREADY_REMOVED';

      // Guarded on `deleted_at IS NULL`: of two concurrent deletions, the
      // second re-evaluates after the first commits, matches nothing, and
      // writes no second audit entry.
      const affected = await tx.participant.updateMany({
        where: {
          id: participantId,
          organizationId: context.organizationId,
          deletedAt: null,
        },
        data: {
          deletedAt: new Date(),
          deletedBy: context.userId,
          deletionReason: reason,
          updatedBy: context.userId,
          version: { increment: 1 },
        },
      });

      if (affected.count === 0) return 'ALREADY_REMOVED';

      await this.audit.record(
        tx,
        context,
        {
          action: 'participant.deleted',
          targetType: 'participant',
          targetId: participantId,
          reason,
        },
        facts,
      );

      return 'REMOVED';
    });
  }

  /** One grouped query for the whole page, not one count per row. */
  private async duplicateCounts(
    context: TenantContext,
    rows: readonly ParticipantRow[],
  ): Promise<Map<string, number>> {
    if (rows.length === 0) {
      return new Map();
    }

    const groups = await this.prisma.participant.groupBy({
      by: ['dedupFingerprint'],
      where: {
        organizationId: context.organizationId,
        deletedAt: null,
        dedupFingerprint: {
          in: [...new Set(rows.map((row) => row.dedupFingerprint))],
        },
      },
      _count: { _all: true },
    });

    // Each listed row is itself active, so it counts once in its own group.
    return new Map(
      groups.map((group) => [group.dedupFingerprint, group._count._all - 1]),
    );
  }

  private async detail(
    client: ParticipantReader,
    context: TenantContext,
    row: ParticipantRow,
  ): Promise<ParticipantDetail> {
    const duplicatesOf = {
      organizationId: context.organizationId,
      deletedAt: null,
      dedupFingerprint: row.dedupFingerprint,
      id: { not: row.id },
    };

    const duplicates = await client.participant.findMany({
      where: duplicatesOf,
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_DUPLICATE_IDS,
    });

    const count =
      duplicates.length < MAX_DUPLICATE_IDS
        ? duplicates.length
        : await client.participant.count({ where: duplicatesOf });

    return {
      ...toProfile(row, count),
      possibleDuplicateIds: duplicates.map((duplicate) => duplicate.id),
    };
  }
}

function comparison<T>(order: 'asc' | 'desc', value: T): { lt: T } | { gt: T } {
  return order === 'desc' ? { lt: value } : { gt: value };
}

/**
 * The rows strictly beyond the boundary, in fetch order:
 * `sort > v OR (sort = v AND id > id₀)`, with `<` when descending.
 */
function keysetClause(
  sortBy: ParticipantSortField,
  order: 'asc' | 'desc',
  [sortValue, id]: readonly [string, string],
): Prisma.ParticipantWhereInput {
  if (sortBy === 'createdAt') {
    const at = new Date(sortValue);
    return {
      OR: [
        { createdAt: comparison(order, at) },
        { createdAt: at, id: comparison(order, id) },
      ],
    };
  }

  return {
    OR: [
      { lastName: comparison(order, sortValue) },
      { lastName: sortValue, id: comparison(order, id) },
    ],
  };
}

function searchClause(search: string): Prisma.ParticipantWhereInput {
  const text = escapeLikePattern(search);
  const email = escapeLikePattern(normalizeEmail(search));

  return {
    OR: [
      { firstName: { contains: text, mode: 'insensitive' } },
      { lastName: { contains: text, mode: 'insensitive' } },
      { normalizedEmail: { contains: email } },
    ],
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}
