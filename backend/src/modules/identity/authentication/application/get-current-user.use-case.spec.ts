import type {
  AuthenticationRepository,
  CurrentUserProfile,
} from '../domain/authentication.repository';
import { GetCurrentUserUseCase } from './get-current-user.use-case';

function profile(
  overrides: Partial<CurrentUserProfile> = {},
): CurrentUserProfile {
  return {
    userId: 'usr_1',
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    displayName: null,
    status: 'ACTIVE',
    emailVerifiedAt: null,
    lastLoginAt: null,
    hasActiveMfa: false,
    ...overrides,
  };
}

function build(found: CurrentUserProfile | null) {
  const lookups: string[] = [];

  const users: AuthenticationRepository = {
    findCandidateByEmail: () => Promise.resolve(null),
    findCandidateById: () => Promise.resolve(null),
    findProfileById: (userId: string) => {
      lookups.push(userId);

      return Promise.resolve(found);
    },
  };

  return { useCase: new GetCurrentUserUseCase(users), lookups };
}

describe('GetCurrentUserUseCase', () => {
  it('returns the profile for the given user id', async () => {
    const { useCase, lookups } = build(profile());

    const result = await useCase.execute('usr_1');

    expect(result).toEqual(profile());
    expect(lookups).toEqual(['usr_1']);
  });

  it('passes through null rather than inventing a default profile', async () => {
    const { useCase } = build(null);

    await expect(useCase.execute('usr_gone')).resolves.toBeNull();
  });

  it('does not touch a password hash or any membership — it is not asked for one', async () => {
    const { useCase } = build(profile());

    const result = await useCase.execute('usr_1');

    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('memberships');
  });
});
