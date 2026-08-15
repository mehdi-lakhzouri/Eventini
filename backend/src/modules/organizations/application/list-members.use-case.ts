import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../../common/types/tenant-context';
import {
  MemberRepository,
  type MemberSummary,
} from '../domain/member.repository';

@Injectable()
export class ListMembersUseCase {
  constructor(private readonly members: MemberRepository) {}

  async execute(context: TenantContext): Promise<MemberSummary[]> {
    return this.members.listMembers(context);
  }
}
