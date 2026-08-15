import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import type { Request } from 'express';

import { AppException } from '../../../common/api/app-exception';
import type { RequestWithId } from '../../../common/types/request-with-id';
import type { TenantContext } from '../../../common/types/tenant-context';
import {
  AuthorizationContextReader,
  CurrentContext,
  RequirePermission,
} from '../../identity';
import { ListMembersUseCase } from '../application/list-members.use-case';
import { ReplaceMemberRolesUseCase } from '../application/replace-member-roles.use-case';
import type { MemberSummary } from '../domain/member.repository';
import { ReplaceMemberRolesDto } from '../dto/replace-roles.dto';

/**
 * Les membres d'une organisation et leurs rôles — EVT-044.
 */
@Controller('organizations/:organizationId/members')
export class MembersController {
  constructor(
    private readonly list: ListMembersUseCase,
    private readonly replaceRoles: ReplaceMemberRolesUseCase,
    private readonly authorization: AuthorizationContextReader,
  ) {}

  /**
   * `GET /organizations/{organizationId}/members`
   *
   * Le présenteur est explicite et c'est la sécurité de cette route : ni hash,
   * ni secret MFA, ni adresse IP de session. Renvoyer la ligne directement
   * gagnerait silencieusement chaque colonne qu'une migration future ajoute.
   */
  @Get()
  @RequirePermission('users.read')
  async index(@CurrentContext() context: TenantContext) {
    const members = await this.list.execute(context);

    return members.map(presentMember);
  }

  /**
   * `PUT /organizations/{organizationId}/members/{membershipId}/roles`
   *
   * `PUT` et non `PATCH` : le corps porte l'ensemble **voulu**. Un delta
   * obligerait le client à connaître l'état courant pour le décrire, et deux
   * administrateurs envoyant chacun le leur produiraient une union que ni l'un
   * ni l'autre n'a demandée.
   */
  @Put(':membershipId/roles')
  @RequirePermission('users.manage_roles')
  async setRoles(
    @CurrentContext() context: TenantContext,
    @Param('membershipId') membershipId: string,
    @Body() body: ReplaceMemberRolesDto,
    @Req() request: Request,
  ) {
    /*
      Le rôle de l'acteur au moment de l'action, résolu ici parce que le
      `Caller` ne le porte pas : il s'arrête aux étapes 1 à 3 de la chaîne. Une
      lecture de plus sur une route qui change des rôles — opération rare, et
      la piste d'audit perdrait l'essentiel sans elle.
    */
    const actor = await this.authorization.read({
      userId: context.userId,
      membershipId: context.membershipId,
    });

    const result = await this.replaceRoles.execute({
      context,
      membershipId,
      roleCodes: body.roleCodes,
      actorRole: actor.role,
      requestId: (request as RequestWithId).id ?? null,
      ipAddress: request.ip ?? null,
    });

    if (typeof result === 'string') {
      throw roleChangeException(result);
    }

    return result;
  }
}

function presentMember(member: MemberSummary) {
  return {
    membershipId: member.membershipId,
    userId: member.userId,
    email: member.email,
    firstName: member.firstName,
    lastName: member.lastName,
    displayName: member.displayName,
    status: member.status,
    mfaEnabled: member.mfaEnabled,
    joinedAt: member.joinedAt?.toISOString() ?? null,
    roleCodes: member.roleCodes,
  };
}

function roleChangeException(refusal: string): AppException {
  switch (refusal) {
    case 'NOT_FOUND':
      return new AppException('RESOURCE_NOT_FOUND', {
        detail: 'No such member in this organization.',
      });

    case 'SELF_ASSIGNMENT':
      return new AppException('AUTH_PERMISSION_DENIED', {
        detail: 'You cannot change your own roles. Ask another administrator.',
      });

    default:
      /*
        Un rôle `PLATFORM` et un code inexistant tombent ici ensemble. Les
        distinguer dirait à un administrateur d'organisation quels rôles
        plateforme existent — et le trigger INV-09 refuserait de toute façon
        l'écriture, mais après avoir confirmé l'information.
      */
      return new AppException('VALIDATION_ERROR', {
        detail: 'One or more roles cannot be assigned in this organization.',
        errors: [
          {
            field: 'roleCodes',
            code: 'UNKNOWN_ROLE',
            message: 'Unknown or non-assignable role.',
          },
        ],
      });
  }
}
