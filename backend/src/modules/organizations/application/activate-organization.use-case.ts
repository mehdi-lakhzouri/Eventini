import { Injectable } from '@nestjs/common';

import type {
  AuthenticationLevel,
  SessionClientType,
} from '../../../infrastructure/database/enums';
import {
  AuthenticationRepository,
  SessionIssuer,
  type IssuedSession,
} from '../../identity';
import {
  OrganizationRepository,
  type ActivationRefusal,
} from '../domain/organization.repository';

export class OrganizationActivationError extends Error {
  constructor(readonly refusal: ActivationRefusal) {
    super(`Organization activation refused: ${refusal}`);
    this.name = 'OrganizationActivationError';
  }
}

export interface ActivateOrganizationCommand {
  readonly userId: string;
  readonly currentSessionId: string;
  readonly organizationId: string;
  readonly clientType: SessionClientType;
  /** Carried over from the session being replaced — never assumed. */
  readonly authenticationLevel: AuthenticationLevel;
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
  readonly requestId: string | null;
}

/**
 * Switching the active organization, by replacing the session — ADR-0002.
 *
 * ## Why a whole new session rather than an UPDATE
 *
 * Updating `user_sessions.organization_id` in place would be one statement and
 * would be wrong twice over. A refresh token captured before the switch would
 * keep working afterwards, now pointing at the new organization; and the audit
 * trail would show one session that silently changed tenant, instead of two
 * sessions with an explicit transition between them. Rotating means a stolen
 * token does not survive a context change.
 *
 * ## The accepted limitation
 *
 * The switch is global to the session, so a user cannot work in two
 * organizations in two tabs. That is the documented trade-off: per-tab context
 * would mean the tenant came from something the client controls, which is
 * exactly what ADR-0002 forbids.
 */
@Injectable()
export class ActivateOrganizationUseCase {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly users: AuthenticationRepository,
    private readonly issuer: SessionIssuer,
  ) {}

  async execute(command: ActivateOrganizationCommand): Promise<IssuedSession> {
    // The path's organization id is used to look up a membership *belonging to
    // this user*, never to scope a query. A forged id finds nothing.
    const target = await this.organizations.findActivationTarget(
      command.userId,
      command.organizationId,
    );

    if (typeof target === 'string') {
      throw new OrganizationActivationError(target);
    }

    // Re-read rather than trust the session: a role or status may have moved
    // since it was issued, and the successor must reflect the account as it is
    // now rather than as it was at sign-in.
    const candidate = await this.users.findCandidateById(command.userId);

    if (candidate === null || candidate.status !== 'ACTIVE') {
      throw new OrganizationActivationError('NO_MEMBERSHIP');
    }

    return this.issuer.issueResolved({
      userId: command.userId,
      userVersion: candidate.userVersion,
      hasPlatformRole: candidate.hasPlatformRole,
      organizationId: target.organizationId,
      membershipId: target.membershipId,
      clientType: command.clientType,
      // Carried across, in both directions. Hardcoding `MFA` would hand every
      // switch an assurance level it never earned — a privilege escalation
      // through a route that only claims to change organization. Hardcoding
      // `PASSWORD` would silently drop an MFA guarantee the session did earn,
      // so a later `@RequireAuthLevel` would refuse a caller who had in fact
      // verified. Only the predecessor's own level is correct here.
      authenticationLevel: command.authenticationLevel,
      userAgent: command.userAgent,
      ipAddress: command.ipAddress,
      requestId: command.requestId,
      replacingSessionId: command.currentSessionId,
    });
  }
}
