import type { SessionClientType } from '../../../../infrastructure/database/enums';

export interface MfaChallenge {
  readonly challengeId: string;
  readonly userId: string;
  readonly clientType: SessionClientType;
  readonly attempts: number;
}

/**
 * The short-lived state between a correct password and a verified code.
 *
 * REDIS_KEYS_AND_LUA_SCRIPTS.md specifies it as `mfa:challenge:{challengeId}`,
 * a HASH with a 300 s TTL holding `userId`, the attempt count and
 * `clientType`. Redis arrives with EVT-029, so this is a port with an
 * in-process implementation until then — see that class for what the
 * difference costs.
 */
export abstract class MfaChallengeStore {
  abstract create(input: {
    readonly userId: string;
    readonly clientType: SessionClientType;
  }): Promise<MfaChallenge>;

  abstract find(challengeId: string): Promise<MfaChallenge | null>;

  /** Returns the new attempt count, or null once the challenge is gone. */
  abstract recordFailure(challengeId: string): Promise<number | null>;

  /** A challenge is single-use: consumed on success, destroyed on exhaustion. */
  abstract destroy(challengeId: string): Promise<void>;
}
