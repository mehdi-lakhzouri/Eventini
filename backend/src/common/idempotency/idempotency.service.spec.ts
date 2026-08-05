import type { IdempotencyStatus } from '../../infrastructure/database/enums';
import type { TenantContext } from '../types/tenant-context';
import {
  IdempotencyRepository,
  type ClaimInput,
  type IdempotencyRecordView,
  type IdempotencyScope,
  type ReclaimInput,
  type SettleInput,
} from './idempotency.repository';
import { IdempotencyService, type BeginInput } from './idempotency.service';
import type { StoredResponse } from './stored-response';

const NOW = new Date('2026-08-15T09:00:00.000Z');
const HASH = 'a'.repeat(64);

const tenant: TenantContext = {
  organizationId: 'org_01',
  membershipId: 'mbr_01',
  userId: 'usr_01',
  sessionId: 'ses_01',
  authLevel: 'PASSWORD',
};

const scope: IdempotencyScope = {
  actorId: 'usr_01',
  method: 'POST',
  route: '/api/v1/events/:eventId/check-ins',
  key: 'A'.repeat(26),
};

function beginInput(overrides: Partial<BeginInput> = {}): BeginInput {
  return {
    scope,
    requestHash: HASH,
    actorSessionId: 'ses_01',
    retention: '24h',
    now: NOW,
    ...overrides,
  };
}

function record(
  overrides: Partial<IdempotencyRecordView> = {},
): IdempotencyRecordView {
  return {
    id: 'idm_01',
    status: 'PENDING',
    requestHash: HASH,
    expiresAt: new Date(NOW.getTime() + 60_000),
    lockedUntil: new Date(NOW.getTime() + 30_000),
    responseStatus: null,
    response: null,
    ...overrides,
  };
}

const storedSuccess: StoredResponse = {
  kind: 'SUCCESS',
  requestId: 'req_original',
  data: { attendanceRecordId: 'att_01' },
};

/**
 * A stand-in for the table, holding exactly the two things the state machine
 * reads: whether the claim succeeded, and what the row says.
 */
class FakeRepository extends IdempotencyRepository {
  claimResults: (string | null)[] = [];
  existing: IdempotencyRecordView | null = null;
  reclaimResult = true;
  readonly reclaims: ReclaimInput[] = [];
  readonly settlements: SettleInput[] = [];

  // Synchronous bodies behind an async port: the port is shaped for
  // PostgreSQL, and an in-memory stand-in needs no await to honour it.
  claim(_context: TenantContext, _input: ClaimInput): Promise<string | null> {
    return Promise.resolve(this.claimResults.shift() ?? null);
  }

  find(
    _context: TenantContext,
    _scope: IdempotencyScope,
  ): Promise<IdempotencyRecordView | null> {
    return Promise.resolve(this.existing);
  }

  reclaim(_context: TenantContext, input: ReclaimInput): Promise<boolean> {
    this.reclaims.push(input);

    return Promise.resolve(this.reclaimResult);
  }

  settle(_context: TenantContext, input: SettleInput): Promise<void> {
    this.settlements.push(input);

    return Promise.resolve();
  }
}

describe('IdempotencyService', () => {
  let repository: FakeRepository;
  let service: IdempotencyService;

  beforeEach(() => {
    repository = new FakeRepository();
    service = new IdempotencyService(repository);
  });

  it('executes when the claim is won', async () => {
    repository.claimResults = ['idm_new'];

    await expect(service.begin(tenant, beginInput())).resolves.toEqual({
      kind: 'EXECUTE',
      recordId: 'idm_new',
    });
  });

  it('refuses a taken key carrying a different request', async () => {
    repository.existing = record({ requestHash: 'b'.repeat(64) });

    await expect(service.begin(tenant, beginInput())).resolves.toEqual({
      kind: 'CONFLICT',
    });
  });

  /** ADR-0012's decision: never wait, always answer. */
  it('reports a live claim as in flight', async () => {
    repository.existing = record();

    await expect(service.begin(tenant, beginInput())).resolves.toEqual({
      kind: 'IN_FLIGHT',
    });
  });

  it('replays a completed record with its original status', async () => {
    repository.existing = record({
      status: 'COMPLETED',
      lockedUntil: null,
      responseStatus: 201,
      response: storedSuccess,
    });

    await expect(service.begin(tenant, beginInput())).resolves.toEqual({
      kind: 'REPLAY',
      response: storedSuccess,
      status: 201,
    });
  });

  it('replays a memorised definitive failure rather than re-running it', async () => {
    const stored: StoredResponse = {
      kind: 'FAILURE',
      requestId: 'req_original',
      code: 'EVENT_NOT_ACTIVE',
      detail: 'Event not active',
      errors: [],
      retryable: false,
      extensions: {},
    };
    repository.existing = record({
      status: 'FAILED_FINAL',
      lockedUntil: null,
      responseStatus: 409,
      response: stored,
    });

    await expect(service.begin(tenant, beginInput())).resolves.toEqual({
      kind: 'REPLAY',
      response: stored,
      status: 409,
    });
  });

  it.each<IdempotencyStatus>(['FAILED_RETRYABLE', 'EXPIRED'])(
    're-executes a %s record',
    async (status) => {
      repository.existing = record({ status, lockedUntil: null });

      await expect(service.begin(tenant, beginInput())).resolves.toEqual({
        kind: 'EXECUTE',
        recordId: 'idm_01',
      });
    },
  );

  /**
   * §6: a `PENDING` row whose lock has lapsed belongs to a process that died,
   * and nothing else will ever finish it.
   */
  it('takes over a claim whose lock has lapsed', async () => {
    repository.existing = record({
      lockedUntil: new Date(NOW.getTime() - 1_000),
    });

    await expect(service.begin(tenant, beginInput())).resolves.toEqual({
      kind: 'EXECUTE',
      recordId: 'idm_01',
    });
    expect(repository.reclaims[0]?.expectedStatus).toBe('PENDING');
  });

  /** The compare-and-swap losing means the row is live again, not free. */
  it('reports in flight when the takeover loses the race', async () => {
    repository.existing = record({ lockedUntil: null });
    repository.reclaimResult = false;

    await expect(service.begin(tenant, beginInput())).resolves.toEqual({
      kind: 'IN_FLIGHT',
    });
  });

  /**
   * §5: an expired key is a first request, and a first request has nothing to
   * conflict with — so expiry is decided before the fingerprint is compared.
   */
  it('treats an expired key with a different body as a first request', async () => {
    repository.existing = record({
      status: 'COMPLETED',
      requestHash: 'b'.repeat(64),
      expiresAt: new Date(NOW.getTime() - 1),
      lockedUntil: null,
    });

    await expect(service.begin(tenant, beginInput())).resolves.toEqual({
      kind: 'EXECUTE',
      recordId: 'idm_01',
    });
    expect(repository.reclaims[0]?.requestHash).toBe(HASH);
  });

  it('carries the 7-day retention into the claim', async () => {
    repository.existing = record({ status: 'EXPIRED', lockedUntil: null });

    await service.begin(tenant, beginInput({ retention: '7d' }));

    expect(repository.reclaims[0]?.expiresAt).toEqual(
      new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
    );
  });

  /** A purge between the failed claim and the read leaves nothing to read. */
  it('retries the claim once when the row vanished', async () => {
    repository.claimResults = [null, 'idm_second'];
    repository.existing = null;

    await expect(service.begin(tenant, beginInput())).resolves.toEqual({
      kind: 'EXECUTE',
      recordId: 'idm_second',
    });
  });

  it('gives up rather than looping when the second claim also fails', async () => {
    repository.claimResults = [];
    repository.existing = null;

    await expect(service.begin(tenant, beginInput())).resolves.toEqual({
      kind: 'CONFLICT',
    });
  });

  /**
   * An unreadable memorised response is treated as no memory rather than as
   * an error: the business write has its own uniqueness, so re-running is the
   * cheaper mistake.
   */
  it('re-executes when the memorised response cannot be read', async () => {
    repository.existing = record({
      status: 'COMPLETED',
      lockedUntil: null,
      responseStatus: 200,
      response: null,
    });

    await expect(service.begin(tenant, beginInput())).resolves.toEqual({
      kind: 'EXECUTE',
      recordId: 'idm_01',
    });
  });

  describe('settlement', () => {
    it('stores the response on success', async () => {
      await service.complete(tenant, {
        recordId: 'idm_01',
        responseStatus: 201,
        response: storedSuccess,
      });

      expect(repository.settlements[0]).toEqual({
        recordId: 'idm_01',
        status: 'COMPLETED',
        responseStatus: 201,
        response: storedSuccess,
      });
    });

    /** A transient failure says nothing about the request, so nothing is kept. */
    it('stores no response for a retryable failure', async () => {
      await service.failRetryable(tenant, {
        recordId: 'idm_01',
        responseStatus: 503,
      });

      expect(repository.settlements[0]).toEqual({
        recordId: 'idm_01',
        status: 'FAILED_RETRYABLE',
        responseStatus: 503,
        response: null,
      });
    });

    it('stores the refusal for a definitive failure', async () => {
      const stored: StoredResponse = {
        kind: 'FAILURE',
        requestId: 'req_01',
        code: 'EVENT_NOT_ACTIVE',
        detail: 'Event not active',
        errors: [],
        retryable: false,
        extensions: {},
      };

      await service.failFinal(tenant, {
        recordId: 'idm_01',
        responseStatus: 409,
        response: stored,
      });

      expect(repository.settlements[0]?.status).toBe('FAILED_FINAL');
      expect(repository.settlements[0]?.response).toBe(stored);
    });
  });
});
