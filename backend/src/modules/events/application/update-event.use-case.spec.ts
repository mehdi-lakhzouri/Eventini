import type { TenantContext } from '../../../common/types/tenant-context';
import {
  EventRepository,
  type EventAuditFacts,
} from '../domain/event.repository';
import { UpdateEventUseCase } from './update-event.use-case';

const context: TenantContext = {
  organizationId: 'org_test',
  membershipId: 'mbr_test',
  userId: 'usr_test',
  sessionId: 'ses_test',
  authLevel: 'PASSWORD',
};

const facts: EventAuditFacts = {
  actorRole: 'CLIENT_ADMIN',
  requestId: 'req_test',
  ipAddress: '127.0.0.1',
};

describe('UpdateEventUseCase', () => {
  it('refuse une mise a jour vide sans appeler le repository', async () => {
    const update = jest.fn<
      ReturnType<EventRepository['update']>,
      Parameters<EventRepository['update']>
    >();
    const repository = repositoryWithUpdate(update);
    const useCase = new UpdateEventUseCase(repository);

    await expect(
      useCase.execute({
        context,
        eventId: 'evt_test',
        expectedVersion: 1,
        changes: {},
        facts,
      }),
    ).resolves.toBe('NO_CHANGES');
    expect(update).not.toHaveBeenCalled();
  });

  it('transmet la version attendue et les faits d audit', async () => {
    const update = jest
      .fn<
        ReturnType<EventRepository['update']>,
        Parameters<EventRepository['update']>
      >()
      .mockResolvedValue('CONFLICT');
    const useCase = new UpdateEventUseCase(repositoryWithUpdate(update));
    const changes = { name: 'Nouveau nom' };

    await expect(
      useCase.execute({
        context,
        eventId: 'evt_test',
        expectedVersion: 7,
        changes,
        facts,
      }),
    ).resolves.toBe('CONFLICT');
    expect(update).toHaveBeenCalledWith(context, 'evt_test', 7, changes, facts);
  });
});

function repositoryWithUpdate(
  update: jest.MockedFunction<EventRepository['update']>,
): EventRepository {
  return {
    list: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    update,
  };
}
