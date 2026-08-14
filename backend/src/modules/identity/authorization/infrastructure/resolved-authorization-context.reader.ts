import { Injectable } from '@nestjs/common';

import {
  AuthorizationContextReader,
  type AuthorizationContext,
} from '../../authentication/domain/authorization-context.reader';
import { PermissionRepository } from '../domain/permission.repository';
import { PermissionResolver } from '../application/permission-resolver.service';

/**
 * Fills the advisory authorization context for `GET /auth/me`.
 *
 * Lives in `authorization` because that is the side allowed to know both: the
 * guards here already read `authentication`'s `CallerResolver`, so the arrow
 * runs authorization → authentication and must not be reversed.
 *
 * ## Scope follows the session, not a preference
 *
 * A session scoped to an organization gets that organization's role and
 * permissions. A platform session — `membershipId` is `null`, a `SUPER_ADMIN`
 * acting outside any tenant (ADR-0002) — gets the platform ones. Never both
 * merged: a union would show an organization admin the platform actions of a
 * role they hold elsewhere, and the interface would offer what the backend
 * would refuse.
 */
@Injectable()
export class ResolvedAuthorizationContextReader extends AuthorizationContextReader {
  constructor(
    private readonly permissions: PermissionResolver,
    private readonly roles: PermissionRepository,
  ) {
    super();
  }

  async read(caller: {
    readonly userId: string;
    readonly membershipId: string | null;
  }): Promise<AuthorizationContext> {
    const { membershipId, userId } = caller;

    /*
      The two reads run together. They hit different tables and neither feeds
      the other, so serialising them would double the latency of a route the
      browser calls on every page load for no gain.
    */
    const [permissions, roleCodes] =
      membershipId === null
        ? await Promise.all([
            this.permissions.forPlatform(userId),
            this.roles.platformRoles(userId),
          ])
        : await Promise.all([
            this.permissions.forMembership(membershipId),
            this.roles.organizationRoles(membershipId),
          ]);

    return {
      /*
        One role, not a list, because that is what the interface asks: "what am
        I here". The schema allows several assignments, and when it happens the
        first code is taken in the order PostgreSQL returned — deliberately not
        "the highest", because no ranking between roles exists anywhere in this
        codebase and inventing one here would put an authorisation decision in
        a display helper.

        Anything that actually depends on authority reads `permissions`, which
        is the union and therefore complete.
      */
      role: roleCodes[0] ?? null,
      permissions,
    };
  }
}
