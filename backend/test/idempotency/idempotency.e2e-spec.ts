import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Pool } from 'pg';
import { createClient } from 'redis';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { buildValidationPipe } from '../../src/bootstrap';
import type { ApiEnvelope } from '../../src/common/api';
import { cookiesConfig } from '../../src/config/cookies.config';
import { PasswordHasher } from '../../src/modules/identity/passwords/domain/password-hasher';
import { IdempotencyProbeModule, PROBE_TARGET_TYPE } from '../fixtures';
import { csrfOf, preSessionCsrf, type Csrf } from '../helpers';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

/**
 * `AppModule`'s import above has already loaded `.env`, so `REDIS_URL` is the
 * same instance the application would use. The override exists for a CI runner
 * that points the suite somewhere else.
 */
const REDIS_URL =
  process.env.REDIS_E2E_URL ??
  process.env.REDIS_URL ??
  'redis://localhost:6380';
const PASSWORD = 'correct horse battery staple';

/** The e2e root: the real application plus the probe route, nothing else. */
@Module({ imports: [AppModule, IdempotencyProbeModule] })
class IdempotencyTestModule {}

interface ProbeData {
  readonly executionId: string;
  readonly probeId: string;
}

interface StoredRecord {
  readonly id: string;
  readonly organization_id: string | null;
  readonly actor_id: string;
  readonly route: string;
  readonly status: string;
  readonly request_hash: string;
  readonly response_status: number | null;
  readonly expires_at: Date;
}

describeWithDatabase('idempotency', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let names: { access: string; refresh: string };

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);
  const suffix = unique();

  const tenants = ['a', 'b'].map((letter) => ({
    organizationId: `org_${letter}${suffix}`,
    userId: `usr_${letter}${suffix}`,
    email: `probe.${letter}.${suffix}@eventini.test`,
    cookies: '',
    csrf: undefined as Csrf | undefined,
  }));

  const [tenantA, tenantB] = tenants as [
    (typeof tenants)[number],
    (typeof tenants)[number],
  ];

  function cookieValue(response: request.Response, name: string): string {
    const jar = (response.headers['set-cookie'] ?? []) as unknown as string[];

    return jar
      .map((cookie) => {
        const [pair] = cookie.split(';');

        return pair?.startsWith(`${name}=`)
          ? pair.slice(name.length + 1)
          : undefined;
      })
      .find((value): value is string => value !== undefined) as string;
  }

  /**
   * Login is a mutation like any other since EVT-028: the pre-session
   * handshake first, then the pair the login rebound to the new session. The
   * probe routes below are mutations too, so they carry that rebound pair.
   */
  async function signIn(
    email: string,
  ): Promise<{ cookies: string; csrf: Csrf }> {
    const handshake = await preSessionCsrf(app);
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/sessions')
      .set(handshake.headers())
      .send({ email, password: PASSWORD, clientType: 'WEB' });

    return {
      cookies: `${names.access}=${cookieValue(response, names.access)}`,
      csrf: csrfOf(app, response),
    };
  }

  function probe(options: {
    readonly cookies: string;
    readonly csrf?: Csrf;
    readonly probeId: string;
    readonly key?: string;
    readonly body?: Record<string, unknown>;
    readonly headers?: Record<string, string>;
  }) {
    const call = request(app.getHttpServer()).post(
      `/api/v1/idempotency-probes/${options.probeId}/executions`,
    );

    // Merged rather than set beside: a bare `.set('Cookie', ...)` would
    // replace the header wholesale and drop the CSRF context.
    if (options.csrf === undefined) {
      call.set('Cookie', options.cookies);
    } else {
      call.set(options.csrf.headers(options.cookies));
    }

    if (options.key !== undefined) {
      call.set('Idempotency-Key', options.key);
    }

    for (const [name, value] of Object.entries(options.headers ?? {})) {
      call.set(name, value);
    }

    return call.send(options.body ?? {});
  }

  async function executionCount(probeId: string): Promise<number> {
    const rows = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_logs
        WHERE target_type = $1 AND target_id = $2`,
      [PROBE_TARGET_TYPE, probeId],
    );

    return Number(rows.rows[0]?.count ?? '0');
  }

  async function storedRecords(key: string): Promise<StoredRecord[]> {
    const rows = await pool.query<StoredRecord>(
      `SELECT id, organization_id, actor_id, route, status, request_hash,
              response_status, expires_at
         FROM idempotency_records WHERE idempotency_key = $1
         ORDER BY created_at`,
      [key],
    );

    return rows.rows;
  }

  const newKey = (): string => `k${unique()}${unique()}`;
  const newProbeId = (): string => `probe${unique()}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [IdempotencyTestModule],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
    });

    const cookies = app.get<ConfigType<typeof cookiesConfig>>(
      cookiesConfig.KEY,
    );
    names = { access: cookies.access.name, refresh: cookies.refresh.name };

    app.use(cookieParser(cookies.secret));
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();

    const hash = await app
      .get(PasswordHasher, { strict: false })
      .hash(PASSWORD);

    pool = new Pool({ connectionString: DATABASE_URL, max: 5 });
    pool.on('error', () => undefined);

    for (const [index, tenant] of tenants.entries()) {
      await pool.query(
        `INSERT INTO organizations (id, name, slug, status, license_plan, is_enabled, updated_at)
         VALUES ($1, 'Probe', $2, 'ACTIVE', 'free', true, now())`,
        [tenant.organizationId, `probe-${index}-${suffix}`],
      );
      await pool.query(
        `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
         VALUES ($1, $2, $2, 'Probe', 'User', 'ACTIVE', now())`,
        [tenant.userId, tenant.email],
      );
      await pool.query(
        `INSERT INTO user_credentials (id, user_id, password_hash, updated_at)
         VALUES ($1, $2, $3, now())`,
        [`cred_${index}${suffix}`, tenant.userId, hash],
      );
      await pool.query(
        `INSERT INTO organization_memberships (id, user_id, organization_id, status, updated_at)
         VALUES ($1, $2, $3, 'ACTIVE', now())`,
        [`mbr_${index}${suffix}`, tenant.userId, tenant.organizationId],
      );

      const session = await signIn(tenant.email);
      tenant.cookies = session.cookies;
      tenant.csrf = session.csrf;
    }
  });

  afterAll(async () => {
    const purge = await pool.connect();
    try {
      await purge.query('BEGIN');
      await purge.query("SET LOCAL eventini.retention_purge = 'on'");
      await purge.query(`DELETE FROM audit_logs WHERE target_type = $1`, [
        PROBE_TARGET_TYPE,
      ]);
      await purge.query(
        `DELETE FROM idempotency_records WHERE actor_id = ANY($1::text[])`,
        [tenants.map((tenant) => tenant.userId)],
      );
      await purge.query(
        `DELETE FROM refresh_token_rotations
          WHERE session_id IN (
            SELECT id FROM user_sessions WHERE user_id = ANY($1::text[]))`,
        [tenants.map((tenant) => tenant.userId)],
      );
      await purge.query('COMMIT');
    } finally {
      purge.release();
    }

    const userIds = tenants.map((tenant) => tenant.userId);
    const organizationIds = tenants.map((tenant) => tenant.organizationId);

    await pool.query(
      `DELETE FROM user_sessions WHERE user_id = ANY($1::text[])`,
      [userIds],
    );
    await pool.query(
      `DELETE FROM organization_memberships WHERE user_id = ANY($1::text[])`,
      [userIds],
    );
    await pool.query(
      `DELETE FROM user_credentials WHERE user_id = ANY($1::text[])`,
      [userIds],
    );
    await pool.query(`DELETE FROM users WHERE id = ANY($1::text[])`, [userIds]);
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1::text[])`, [
      organizationIds,
    ]);

    await pool.end();
    await app.close();
  });

  it('executes a first request and records the claim', async () => {
    const key = newKey();
    const probeId = newProbeId();

    const response = await probe({
      cookies: tenantA.cookies,
      csrf: tenantA.csrf,
      probeId,
      key,
    });

    expect(response.status).toBe(201);
    expect(await executionCount(probeId)).toBe(1);

    const [record] = await storedRecords(key);
    expect(record?.status).toBe('COMPLETED');
    expect(record?.organization_id).toBe(tenantA.organizationId);
    expect(record?.response_status).toBe(201);
  });

  /**
   * Test 1 of §13, in the shape the sprint-12 check-in will take: one row
   * written, and the second caller none the wiser that it did not run.
   */
  it('replays an identical request without running the handler again', async () => {
    const key = newKey();
    const probeId = newProbeId();

    const first = await probe({
      cookies: tenantA.cookies,
      csrf: tenantA.csrf,
      probeId,
      key,
    });
    const second = await probe({
      cookies: tenantA.cookies,
      csrf: tenantA.csrf,
      probeId,
      key,
    });

    const firstBody = first.body as ApiEnvelope<ProbeData>;
    const secondBody = second.body as ApiEnvelope<ProbeData>;

    expect(await executionCount(probeId)).toBe(1);
    expect(second.status).toBe(201);
    expect(secondBody.data).toEqual(firstBody.data);
    expect(secondBody.meta.idempotency).toEqual({
      replayed: true,
      originalRequestId: firstBody.meta.requestId,
    });
    // The replay's own request id, so a log search finds both executions.
    expect(secondBody.meta.requestId).not.toBe(firstBody.meta.requestId);
  });

  it('leaves meta.idempotency off a first execution', async () => {
    const response = await probe({
      cookies: tenantA.cookies,
      csrf: tenantA.csrf,
      probeId: newProbeId(),
      key: newKey(),
    });

    expect(
      (response.body as ApiEnvelope<ProbeData>).meta.idempotency,
    ).toBeUndefined();
  });

  /** Test 2 of §13. */
  it('refuses the same key carrying a different body', async () => {
    const key = newKey();
    const probeId = newProbeId();

    await probe({
      cookies: tenantA.cookies,
      csrf: tenantA.csrf,
      probeId,
      key,
      body: { a: 1 },
    });
    const clash = await probe({
      cookies: tenantA.cookies,
      csrf: tenantA.csrf,
      probeId,
      key,
      body: { a: 2 },
    });

    expect(clash.status).toBe(409);
    expect((clash.body as ApiEnvelope<null>).error?.code).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
    expect(await executionCount(probeId)).toBe(1);
  });

  /**
   * Test 3 of §13, and the reason `organization_id` is in the unique index:
   * two tenants cannot collide, however they choose their keys.
   */
  it('keeps the same key independent in two organizations', async () => {
    const key = newKey();
    const probeId = newProbeId();

    const first = await probe({
      cookies: tenantA.cookies,
      csrf: tenantA.csrf,
      probeId,
      key,
    });
    const second = await probe({
      cookies: tenantB.cookies,
      csrf: tenantB.csrf,
      probeId,
      key,
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await executionCount(probeId)).toBe(2);

    const records = await storedRecords(key);
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.organization_id).sort()).toEqual(
      [tenantA.organizationId, tenantB.organizationId].sort(),
    );
    expect(
      (second.body as ApiEnvelope<ProbeData>).meta.idempotency,
    ).toBeUndefined();
  });

  /** Test 7 of §13 — two client builds serialising the same intention. */
  it('recognises a reordered body as the same request', async () => {
    const key = newKey();
    const probeId = newProbeId();

    await probe({
      cookies: tenantA.cookies,
      csrf: tenantA.csrf,
      probeId,
      key,
      body: { a: 1, b: 2 },
    });
    const replay = await probe({
      cookies: tenantA.cookies,
      csrf: tenantA.csrf,
      probeId,
      key,
      body: { b: 2, a: 1 },
    });

    expect(replay.status).toBe(201);
    expect(
      (replay.body as ApiEnvelope<ProbeData>).meta.idempotency?.replayed,
    ).toBe(true);
    expect(await executionCount(probeId)).toBe(1);
  });

  /**
   * Test 8 of §13. `traceparent` changes on every hop by design; hashing it
   * would make every retry a `409` — the mechanism refusing the exact case it
   * exists for.
   */
  it('ignores volatile headers', async () => {
    const key = newKey();
    const probeId = newProbeId();

    await probe({
      cookies: tenantA.cookies,
      csrf: tenantA.csrf,
      probeId,
      key,
      headers: {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
        'X-Request-Id': 'req_client_one',
        'User-Agent': 'eventini-scanner/1.0',
      },
    });
    const replay = await probe({
      cookies: tenantA.cookies,
      csrf: tenantA.csrf,
      probeId,
      key,
      headers: {
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        'X-Request-Id': 'req_client_two',
        'User-Agent': 'eventini-scanner/2.0',
      },
    });

    expect(
      (replay.body as ApiEnvelope<ProbeData>).meta.idempotency?.replayed,
    ).toBe(true);
    expect(await executionCount(probeId)).toBe(1);
  });

  describe('the key itself', () => {
    it('refuses a request without one', async () => {
      const probeId = newProbeId();
      const response = await probe({
        cookies: tenantA.cookies,
        csrf: tenantA.csrf,
        probeId,
      });

      expect(response.status).toBe(400);
      expect((response.body as ApiEnvelope<null>).error?.code).toBe(
        'VALIDATION_ERROR',
      );
      expect(await executionCount(probeId)).toBe(0);
    });

    it('refuses a key outside the documented format', async () => {
      const response = await probe({
        cookies: tenantA.cookies,
        csrf: tenantA.csrf,
        probeId: newProbeId(),
        key: 'too-short',
      });

      expect(response.status).toBe(400);
    });
  });

  /**
   * Test 6 of §13, and ADR-0012's one behavioural choice: the client waits,
   * not the server. Forced by putting the row back the way a still-running
   * request leaves it.
   */
  it('answers 409 with Retry-After while a claim is in flight', async () => {
    const key = newKey();
    const probeId = newProbeId();

    await probe({ cookies: tenantA.cookies, csrf: tenantA.csrf, probeId, key });
    await pool.query(
      `UPDATE idempotency_records
          SET status = 'PENDING', locked_until = now() + interval '1 minute'
        WHERE idempotency_key = $1`,
      [key],
    );

    const inFlight = await probe({
      cookies: tenantA.cookies,
      csrf: tenantA.csrf,
      probeId,
      key,
    });

    expect(inFlight.status).toBe(409);
    expect(inFlight.headers['retry-after']).toBe('2');
    expect((inFlight.body as ApiEnvelope<null>).error?.retryable).toBe(true);
    expect(await executionCount(probeId)).toBe(1);
  });

  /** §6: a claim nobody is holding any more must not wedge the key. */
  it('takes over a claim whose lock has lapsed', async () => {
    const key = newKey();
    const probeId = newProbeId();

    await probe({ cookies: tenantA.cookies, csrf: tenantA.csrf, probeId, key });
    await pool.query(
      `UPDATE idempotency_records
          SET status = 'PENDING', locked_until = now() - interval '1 minute'
        WHERE idempotency_key = $1`,
      [key],
    );

    const retry = await probe({
      cookies: tenantA.cookies,
      csrf: tenantA.csrf,
      probeId,
      key,
    });

    expect(retry.status).toBe(201);
    expect(await executionCount(probeId)).toBe(2);
  });

  /** §5: an expired key is a first request, not a conflict. */
  it('re-executes once the key has expired', async () => {
    const key = newKey();
    const probeId = newProbeId();

    await probe({
      cookies: tenantA.cookies,
      csrf: tenantA.csrf,
      probeId,
      key,
      body: { a: 1 },
    });
    await pool.query(
      `UPDATE idempotency_records SET expires_at = now() - interval '1 second'
        WHERE idempotency_key = $1`,
      [key],
    );

    const again = await probe({
      cookies: tenantA.cookies,
      csrf: tenantA.csrf,
      probeId,
      key,
      body: { a: 2 },
    });

    expect(again.status).toBe(201);
    expect(await executionCount(probeId)).toBe(2);
  });

  /**
   * §5: a definitive refusal is memorised. Re-running it would reach the same
   * refusal and pay for the trip.
   */
  it('memorises a definitive refusal instead of re-running it', async () => {
    const key = newKey();
    const probeId = newProbeId();
    const body = { refuse: true };

    const first = await probe({
      cookies: tenantA.cookies,
      csrf: tenantA.csrf,
      probeId,
      key,
      body,
    });
    const second = await probe({
      cookies: tenantA.cookies,
      csrf: tenantA.csrf,
      probeId,
      key,
      body,
    });

    expect(first.status).toBe(409);
    expect(second.status).toBe(409);
    expect((second.body as ApiEnvelope<null>).error?.code).toBe(
      'EVENT_NOT_ACTIVE',
    );
    expect((second.body as ApiEnvelope<null>).meta.idempotency?.replayed).toBe(
      true,
    );

    const [record] = await storedRecords(key);
    expect(record?.status).toBe('FAILED_FINAL');
  });

  /**
   * Test 16 of §13, and the one that decides ADR-0012 was right.
   *
   * Redis is emptied completely between the two calls. PostgreSQL is the
   * source of truth, so nothing changes; a Redis-only design would have lost
   * the claim here and written a second record — a double check-in produced by
   * a cache eviction.
   */
  it('replays after a Redis FLUSHALL, without a duplicate record', async () => {
    const key = newKey();
    const probeId = newProbeId();

    await probe({ cookies: tenantA.cookies, csrf: tenantA.csrf, probeId, key });

    const redis = createClient({ url: REDIS_URL });
    await redis.connect();
    await redis.flushAll();
    await redis.quit();

    const replay = await probe({
      cookies: tenantA.cookies,
      csrf: tenantA.csrf,
      probeId,
      key,
    });

    expect(replay.status).toBe(201);
    expect(
      (replay.body as ApiEnvelope<ProbeData>).meta.idempotency?.replayed,
    ).toBe(true);
    expect(await executionCount(probeId)).toBe(1);
    expect(await storedRecords(key)).toHaveLength(1);
  });

  describe('what is stored', () => {
    it('stores the route template rather than the concrete URI', async () => {
      const key = newKey();
      const probeId = newProbeId();

      await probe({
        cookies: tenantA.cookies,
        csrf: tenantA.csrf,
        probeId,
        key,
      });

      const [record] = await storedRecords(key);
      expect(record?.route).toBe(
        '/api/v1/idempotency-probes/:probeId/executions',
      );
      expect(record?.route).not.toContain(probeId);
    });

    /** §8: seven days, because a scanner can be offline for a whole event. */
    it('honours the 7-day retention the route asked for', async () => {
      const key = newKey();

      await probe({
        cookies: tenantA.cookies,
        csrf: tenantA.csrf,
        probeId: newProbeId(),
        key,
      });

      const [record] = await storedRecords(key);
      const days =
        ((record?.expires_at.getTime() ?? 0) - Date.now()) / 86_400_000;

      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThan(7.1);
    });

    /**
     * A valid pre-session CSRF pair is supplied so the refusal is about the
     * missing session. `CsrfGuard` runs ahead of authentication, so a request
     * carrying neither would stop at 403 and prove nothing about what an
     * unauthenticated caller leaves behind — which is the point here.
     */
    it('never stores a response body for an unauthenticated caller', async () => {
      const key = newKey();
      const response = await probe({
        cookies: '',
        csrf: await preSessionCsrf(app),
        probeId: newProbeId(),
        key,
      });

      expect(response.status).toBe(401);
      expect(await storedRecords(key)).toHaveLength(0);
    });
  });
});
