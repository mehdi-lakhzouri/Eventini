import type { TenantContext } from '../../../common/types/tenant-context';
import {
  ParticipantRepository,
  type ParticipantAuditFacts,
  type ParticipantValues,
} from '../domain/participant.repository';
import { MAX_METADATA_BYTES } from '../domain/participant-values';
import { CreateParticipantUseCase } from './create-participant.use-case';
import { DeleteParticipantUseCase } from './delete-participant.use-case';
import { UpdateParticipantUseCase } from './update-participant.use-case';

const context: TenantContext = {
  organizationId: 'org_test',
  membershipId: 'mbr_test',
  userId: 'usr_test',
  sessionId: 'ses_test',
  authLevel: 'PASSWORD',
};

const facts: ParticipantAuditFacts = {
  actorRole: 'CLIENT_ADMIN',
  requestId: 'req_test',
  ipAddress: '127.0.0.1',
};

const values: ParticipantValues = {
  firstName: '  Ada ',
  lastName: 'Lovelace  ',
  email: '  Ada@Example.com ',
  phone: null,
  participantType: 'STANDARD',
  organizationName: '   ',
  jobTitle: ' Mathematician ',
  country: 'gb',
  externalReference: null,
  metadata: { badge: 'blue' },
};

const oversizedMetadata = { blob: 'x'.repeat(MAX_METADATA_BYTES) };

function repository() {
  const create = jest
    .fn<
      ReturnType<ParticipantRepository['create']>,
      Parameters<ParticipantRepository['create']>
    >()
    .mockResolvedValue('EMAIL_TAKEN');
  const update = jest
    .fn<
      ReturnType<ParticipantRepository['update']>,
      Parameters<ParticipantRepository['update']>
    >()
    .mockResolvedValue('CONFLICT');
  const remove = jest
    .fn<
      ReturnType<ParticipantRepository['remove']>,
      Parameters<ParticipantRepository['remove']>
    >()
    .mockResolvedValue('REMOVED');
  const participants: ParticipantRepository = {
    list: jest.fn(),
    find: jest.fn(),
    create,
    update,
    remove,
  };

  return { participants, create, update, remove };
}

describe('CreateParticipantUseCase', () => {
  it('stores what the caller meant, not what their form padded', async () => {
    const { participants, create } = repository();

    await new CreateParticipantUseCase(participants).execute({
      context,
      values,
      facts,
    });

    expect(create).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        firstName: 'Ada',
        lastName: 'Lovelace',
        // Trimmed, but the case the participant typed is kept — only
        // `normalized_email` is folded, by the repository.
        email: 'Ada@Example.com',
        organizationName: null,
        jobTitle: 'Mathematician',
        country: 'GB',
        facts,
      }),
    );
  });

  it('allocates a participant id with the par_ prefix', async () => {
    const { participants, create } = repository();

    await new CreateParticipantUseCase(participants).execute({
      context,
      values,
      facts,
    });

    expect(create.mock.calls[0]?.[1].participantId).toMatch(/^par_/);
  });

  it('refuses oversized metadata without writing', async () => {
    const { participants, create } = repository();

    await expect(
      new CreateParticipantUseCase(participants).execute({
        context,
        values: { ...values, metadata: oversizedMetadata },
        facts,
      }),
    ).resolves.toBe('METADATA_TOO_LARGE');
    expect(create).not.toHaveBeenCalled();
  });

  it('passes an email collision through as a refusal', async () => {
    await expect(
      new CreateParticipantUseCase(repository().participants).execute({
        context,
        values,
        facts,
      }),
    ).resolves.toBe('EMAIL_TAKEN');
  });
});

describe('UpdateParticipantUseCase', () => {
  it('refuses an empty change set without writing', async () => {
    const { participants, update } = repository();

    await expect(
      new UpdateParticipantUseCase(participants).execute({
        context,
        participantId: 'par_test',
        expectedVersion: 1,
        changes: {},
        facts,
      }),
    ).resolves.toBe('NO_CHANGES');
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses oversized metadata without writing', async () => {
    const { participants, update } = repository();

    await expect(
      new UpdateParticipantUseCase(participants).execute({
        context,
        participantId: 'par_test',
        expectedVersion: 1,
        changes: { metadata: oversizedMetadata },
        facts,
      }),
    ).resolves.toBe('METADATA_TOO_LARGE');
    expect(update).not.toHaveBeenCalled();
  });

  it('cleans only the fields being changed, and clears blank ones', async () => {
    const { participants, update } = repository();

    await expect(
      new UpdateParticipantUseCase(participants).execute({
        context,
        participantId: 'par_test',
        expectedVersion: 4,
        changes: { lastName: ' Byron ', jobTitle: '  ', country: 'fr' },
        facts,
      }),
    ).resolves.toBe('CONFLICT');

    expect(update).toHaveBeenCalledWith(
      context,
      'par_test',
      4,
      { lastName: 'Byron', jobTitle: null, country: 'FR' },
      facts,
    );
  });
});

describe('DeleteParticipantUseCase', () => {
  it('records a blank reason as no reason', async () => {
    const { participants, remove } = repository();

    await new DeleteParticipantUseCase(participants).execute({
      context,
      participantId: 'par_test',
      reason: '   ',
      facts,
    });

    expect(remove).toHaveBeenCalledWith(context, 'par_test', null, facts);
  });
});
