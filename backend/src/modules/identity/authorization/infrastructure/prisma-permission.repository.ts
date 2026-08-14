import { Inject, Injectable } from '@nestjs/common';

import { TENANT_SCOPED_PRISMA } from '../../../../infrastructure/database/prisma.tokens';
import type { TenantScopedPrismaClient } from '../../../../infrastructure/database/tenant-scope.extension';
import { PermissionRepository } from '../domain/permission.repository';

/** Rows come back as `{ code }`; flattened and de-duplicated once, here. */
type CodeRow = { readonly code: string };

@Injectable()
export class PrismaPermissionRepository extends PermissionRepository {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA)
    private readonly prisma: TenantScopedPrismaClient,
  ) {
    super();
  }

  /**
   * Scoped by `membershipId`, which belongs to exactly one organization, so
   * the result cannot span tenants. The `scope` filter on the role is not
   * decoration: a PLATFORM role reachable through a membership assignment
   * would hand organization-level callers platform privileges, which is the
   * most direct privilege escalation this schema allows if left unchecked.
   *
   * Revocation here is `revoked_at`, with no `status` column — unlike
   * `platform_role_assignments`, which has both. Filtering on a status that
   * does not exist would have made this query throw rather than over-grant,
   * but the asymmetry between the two tables is worth stating so the next
   * reader does not "fix" it by adding one.
   */
  async organizationPermissions(membershipId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<CodeRow[]>`
      SELECT DISTINCT p."code"
        FROM "membership_role_assignments" mra
        JOIN "roles" r  ON r."id" = mra."role_id" AND r."scope" = 'ORGANIZATION'
        JOIN "role_permissions" rp ON rp."role_id" = r."id"
        JOIN "permissions" p ON p."id" = rp."permission_id"
       WHERE mra."membership_id" = ${membershipId}
         AND mra."revoked_at" IS NULL
    `;

    return rows.map((row) => row.code);
  }

  /**
   * Les codes de rôle, sans passer par `role_permissions`.
   *
   * Un rôle dépourvu de permission — cas légitime pendant qu'un catalogue se
   * construit — disparaîtrait d'une jointure passant par les permissions. La
   * requête s'arrête donc à `roles`.
   */
  async organizationRoles(membershipId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<CodeRow[]>`
      SELECT DISTINCT r."code"
        FROM "membership_role_assignments" mra
        JOIN "roles" r ON r."id" = mra."role_id" AND r."scope" = 'ORGANIZATION'
       WHERE mra."membership_id" = ${membershipId}
         AND mra."revoked_at" IS NULL
    `;

    return rows.map((row) => row.code);
  }

  async platformRoles(userId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<CodeRow[]>`
      SELECT DISTINCT r."code"
        FROM "platform_role_assignments" pra
        JOIN "roles" r ON r."id" = pra."role_id" AND r."scope" = 'PLATFORM'
       WHERE pra."user_id" = ${userId}
         AND pra."status" = 'ACTIVE'
         AND pra."revoked_at" IS NULL
    `;

    return rows.map((row) => row.code);
  }

  async platformPermissions(userId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<CodeRow[]>`
      SELECT DISTINCT p."code"
        FROM "platform_role_assignments" pra
        JOIN "roles" r  ON r."id" = pra."role_id" AND r."scope" = 'PLATFORM'
        JOIN "role_permissions" rp ON rp."role_id" = r."id"
        JOIN "permissions" p ON p."id" = rp."permission_id"
       WHERE pra."user_id" = ${userId}
         AND pra."status" = 'ACTIVE'
         AND pra."revoked_at" IS NULL
    `;

    return rows.map((row) => row.code);
  }

  /**
   * The validity window is **in the WHERE clause**, not checked afterwards.
   *
   * ADR-0004 is explicit about this, and the reason is that a filter applied
   * in application code is one an early `return` or a refactor can skip. A row
   * outside its window must not be *returned* at all, so the boundary cannot
   * be forgotten downstream.
   *
   * `NULL` on either bound means unbounded on that side, which is why each
   * comparison is written as "null or satisfied" rather than a plain BETWEEN.
   *
   * The join from `assignment_type` to `roles.code` is the schema's own
   * convention (ENTITY_RELATIONSHIPS.md §4.4): an assignment type with no
   * matching EVENT-scoped role grants nothing, silently, which is why the seed
   * keeps the two sets aligned.
   */
  async eventPermissions(
    membershipId: string,
    eventId: string,
    at: Date,
  ): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<CodeRow[]>`
      SELECT DISTINCT p."code"
        FROM "event_user_assignments" eua
        JOIN "roles" r  ON r."code" = eua."assignment_type" AND r."scope" = 'EVENT'
        JOIN "role_permissions" rp ON rp."role_id" = r."id"
        JOIN "permissions" p ON p."id" = rp."permission_id"
       WHERE eua."membership_id" = ${membershipId}
         AND eua."event_id" = ${eventId}
         AND eua."status" = 'ACTIVE'
         AND eua."revoked_at" IS NULL
         AND (eua."valid_from"  IS NULL OR eua."valid_from"  <= ${at})
         AND (eua."valid_until" IS NULL OR eua."valid_until" >= ${at})
    `;

    return rows.map((row) => row.code);
  }
}
