import type { TenantContext } from '../../../common/types/tenant-context';
import {
  EventRepository,
  type EventAuditFacts,
  type EventProfile,
  type EventValues,
} from '../domain/event.repository';
import { CreateEventUseCase } from './create-event.use-case';

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

const values: EventValues = {
  name: 'Eventini Summit',
  slug: 'eventini-summit',
  description: null,
  timezone: 'Africa/Tunis',
  startsAt: new Date('2027-04-08T08:00:00.000Z'),
  endsAt: new Date('2027-04-08T18:00:00.000Z'),
  checkInOpensAt: null,
  checkInClosesAt: null,
  capacity: 400,
  locationName: 'Tunis',
  settings: {},
};

const profile: EventProfile = {
  eventId: 'evt_test',
  organizationId: context.organizationId,
  ...values,
  status: 'DRAFT',
  eventCode: '23456789',
  version: 1,
  createdAt: new Date('2027-01-01T00:00:00.000Z'),
  updatedAt: new Date('2027-01-01T00:00:00.000Z'),
};

describe('CreateEventUseCase', () => {
  it('refuse une chronologie incoherente avant toute ecriture', async () => {
    const create = jest.fn<
      ReturnType<EventRepository['create']>,
      Parameters<EventRepository['create']>
    >();
    const repository = repositoryWithCreate(create);
    const useCase = new CreateEventUseCase(repository);

    await expect(
      useCase.execute({
        context,
        facts,
        values: { ...values, endsAt: values.startsAt },
      }),
    ).resolves.toBe('INVALID_SCHEDULE');
    expect(create).not.toHaveBeenCalled();
  });

  it('reessaie un event_code en collision sans changer l identifiant', async () => {
    const create = jest
      .fn<
        ReturnType<EventRepository['create']>,
        Parameters<EventRepository['create']>
      >()
      .mockResolvedValueOnce('EVENT_CODE_COLLISION')
      .mockResolvedValueOnce(profile);
    const repository = repositoryWithCreate(create);
    const useCase = new CreateEventUseCase(repository);

    await expect(useCase.execute({ context, facts, values })).resolves.toBe(
      profile,
    );
    expect(create).toHaveBeenCalledTimes(2);

    const first = create.mock.calls[0]![1];
    const second = create.mock.calls[1]![1];

    expect(first.eventId).toBe(second.eventId);
    expect(first.eventCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(second.eventCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
  });

  it('arrete immediatement quand le slug du tenant est deja pris', async () => {
    const create = jest
      .fn<
        ReturnType<EventRepository['create']>,
        Parameters<EventRepository['create']>
      >()
      .mockResolvedValue('SLUG_TAKEN');
    const useCase = new CreateEventUseCase(repositoryWithCreate(create));

    await expect(useCase.execute({ context, facts, values })).resolves.toBe(
      'SLUG_TAKEN',
    );
    expect(create).toHaveBeenCalledTimes(1);
  });
});

function repositoryWithCreate(
  create: jest.MockedFunction<EventRepository['create']>,
): EventRepository {
  return {
    list: jest.fn(),
    find: jest.fn(),
    create,
    update: jest.fn(),
  };
}
