import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import {
  OrganizationRepository,
  type OrganizationProfile,
} from '../domain/organization.repository';

/**
 * La lecture derrière `GET /organizations/{organizationId}` — EVT-042.
 *
 * L'identifiant du chemin ne construit pas cette requête : le contexte tenant
 * le fait, et le guard a déjà refusé si les deux divergent. Le paramètre reste
 * dans l'URL parce que la ressource est nommée par lui, pas parce qu'on le lit.
 */
@Injectable()
export class GetOrganizationUseCase {
  constructor(private readonly organizations: OrganizationRepository) {}

  async execute(context: TenantContext): Promise<OrganizationProfile | null> {
    return this.organizations.findProfile(context);
  }
}
