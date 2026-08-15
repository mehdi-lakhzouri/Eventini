import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import {
  OrganizationRepository,
  type OrganizationChanges,
  type OrganizationProfile,
  type OrganizationWriteFailure,
} from '../domain/organization.repository';

/**
 * L'écriture derrière `PATCH /organizations/{organizationId}` — EVT-042 et
 * EVT-032.
 */
@Injectable()
export class UpdateOrganizationUseCase {
  constructor(private readonly organizations: OrganizationRepository) {}

  async execute(input: {
    context: TenantContext;
    expectedVersion: number;
    changes: OrganizationChanges;
  }): Promise<OrganizationProfile | OrganizationWriteFailure> {
    /*
      Un corps vide est refusé plutôt qu'accepté sans effet. Accepté, il
      incrémenterait la version et invaliderait l'`ETag` de tous les autres
      lecteurs pour un changement qui n'a pas eu lieu — chacun recevrait un
      conflit sur sa prochaine écriture, sans que rien n'ait bougé.
    */
    if (input.changes.name === undefined && input.changes.slug === undefined) {
      return 'NO_CHANGES';
    }

    return this.organizations.updateProfile(
      input.context,
      input.expectedVersion,
      input.changes,
      input.context.userId,
    );
  }
}
