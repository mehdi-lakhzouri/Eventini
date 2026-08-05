import { Injectable } from '@nestjs/common';

import type { SessionClientType } from '../../../../infrastructure/database/enums';
import {
  ID_PREFIXES,
  newId,
} from '../../../../infrastructure/database/identifiers';
import {
  MfaChallengeStore,
  type MfaChallenge,
} from '../domain/mfa-challenge.store';

interface Entry {
  readonly userId: string;
  readonly clientType: SessionClientType;
  readonly expiresAt: number;
  attempts: number;
}

/**
 * In-process challenge store, until EVT-029 brings Redis.
 *
 * ## What this costs, stated plainly
 *
 * A challenge created on one instance cannot be verified on another, so a
 * multi-instance deployment would make some logins fail at the code step and
 * require a retry. That is an availability limitation, **not** a weakening:
 * an unknown challenge is refused, so the failure is closed. Attempt counting
 * and expiry are enforced exactly as the Redis version will enforce them.
 *
 * The contract is the port, so EVT-029 replaces this class and nothing else.
 */
@Injectable()
export class MemoryMfaChallengeStore extends MfaChallengeStore {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ttlSeconds: number,
    private readonly maxAttempts: number,
  ) {
    super();
  }

  // Synchronous bodies behind an async port: the port is shaped for Redis,
  // which this is standing in for, and a `Map` needs no await to honour it.
  create(input: {
    userId: string;
    clientType: SessionClientType;
  }): Promise<MfaChallenge> {
    this.sweep();

    const challengeId = newId(ID_PREFIXES.session);

    this.entries.set(challengeId, {
      userId: input.userId,
      clientType: input.clientType,
      expiresAt: Date.now() + this.ttlSeconds * 1000,
      attempts: 0,
    });

    return Promise.resolve({
      challengeId,
      userId: input.userId,
      clientType: input.clientType,
      attempts: 0,
    });
  }

  find(challengeId: string): Promise<MfaChallenge | null> {
    const entry = this.entries.get(challengeId);

    if (entry === undefined) {
      return Promise.resolve(null);
    }

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(challengeId);

      return Promise.resolve(null);
    }

    return Promise.resolve({
      challengeId,
      userId: entry.userId,
      clientType: entry.clientType,
      attempts: entry.attempts,
    });
  }

  recordFailure(challengeId: string): Promise<number | null> {
    const entry = this.entries.get(challengeId);

    if (entry === undefined) {
      return Promise.resolve(null);
    }

    entry.attempts += 1;

    // Destroyed rather than left exhausted: a challenge nobody can use is a
    // challenge that should not answer questions about whether it existed.
    if (entry.attempts >= this.maxAttempts) {
      this.entries.delete(challengeId);
    }

    return Promise.resolve(entry.attempts);
  }

  destroy(challengeId: string): Promise<void> {
    this.entries.delete(challengeId);

    return Promise.resolve();
  }

  /** Bounded growth without a timer: expired entries go on the next create. */
  private sweep(): void {
    const now = Date.now();

    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(id);
      }
    }
  }
}
