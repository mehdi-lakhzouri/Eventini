import { randomUUID } from 'node:crypto';

import type { ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { Pool } from 'pg';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { buildValidationPipe } from '../../src/bootstrap';
import type { ApiEnvelope } from '../../src/common/api';
import { cookiesConfig } from '../../src/config/cookies.config';
import { PermissionsVersionStore } from '../../src/modules/identity/authorization/domain/permissions-version.store';
import { PasswordHasher } from '../../src/modules/identity/passwords/domain/password-hasher';
import {
  cookieValue,
  csrfOf,
  preSessionCsrf,
  resetRateLimits,
  type Csrf,
} from '../helpers';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;
const PASSWORD = 'correct horse battery staple';

interface SessionResponse {
  sessionId: string;
  organizationId: string;
  eventId: string;
  name: string;
  sessionType: string;
  status: string;
  startsAt: string;
  endsAt: string;
  requiresSeparateCheckIn: boolean;
}

describeWithDatabase('Event session CRUD — EVT-050', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let names: { access: string; refresh: string };

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = {
    org: `org_s${suffix}`,
    otherOrg: `org_t${suffix}`,
    user: `usr_s${suffix}`,
    membership: `mbr_s${suffix}`,
    event: `evt_s${suffix}`,
    otherEvent: `evt_t${suffix}`,
    otherSession: `esn_t${suffix}`,
  };
  const email = `sessions.${suffix}@eventini.test`;
  const server = () => app.getHttpServer();

  async function signIn(): Promise<{ jar: string; csrf: Csrf }> {
    const response = await request(server())
      .post('/api/v1/auth/sessions')
      .set((await preSessionCsrf(app)).headers())
      .send({ email, password: PASSWORD, clientType: 'WEB' })
      .expect(201);
    return {
      jar: `${names.access}=${cookieValue(response, names.access)}; ${names.refresh}=${cookieValue(response, names.refresh)}`,
      csrf: csrfOf(app, response),
    };
  }

  function createSession(jar: string, csrf: Csrf, eventId = ids.event) {
    return request(server())
      .post(`/api/v1/events/${eventId}/sessions`)
      .set(csrf.headers(jar))
      .send({
        name: 'Opening workshop',
        sessionType: 'WORKSHOP',
        startsAt: '2027-04-08T09:00:00.000Z',
        endsAt: '2027-04-08T11:00:00.000Z',
        checkInOpensAt: '2027-04-08T08:30:00.000Z',
        checkInClosesAt: '2027-04-08T10:00:00.000Z',
        capacity: 80,
        locationName: 'Room A',
        requiresSeparateCheckIn: false,
      });
  }

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(AppModule, {
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

    pool = new Pool({ connectionString: DATABASE_URL, max: 3 });
    pool.on('error', () => undefined);
    const hash = await app
      .get(PasswordHasher, { strict: false })
      .hash(PASSWORD);
    for (const [id, slug] of [
      [ids.org, `sessions-${suffix}`],
      [ids.otherOrg, `sessions-other-${suffix}`],
    ]) {
      await pool.query(
        `INSERT INTO organizations (id, name, slug, status, license_plan, is_enabled, updated_at)
         VALUES ($1, 'Sessions', $2, 'ACTIVE', 'free', true, now())`,
        [id, slug],
      );
    }
    await pool.query(
      `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
       VALUES ($1, $2, $2, 'Sam', 'Sessions', 'ACTIVE', now())`,
      [ids.user, email],
    );
    await pool.query(
      `INSERT INTO user_credentials (id, user_id, password_hash, updated_at)
       VALUES ($1, $2, $3, now())`,
      [`cred_${suffix}`, ids.user, hash],
    );
    await pool.query(
      `INSERT INTO organization_memberships (id, user_id, organization_id, status, updated_at)
       VALUES ($1, $2, $3, 'ACTIVE', now())`,
      [ids.membership, ids.user, ids.org],
    );
    const role = await pool.query<{ id: string }>(
      `SELECT id FROM roles WHERE code = 'CLIENT_ADMIN'`,
    );
    await pool.query(
      `INSERT INTO membership_role_assignments (id, membership_id, organization_id, role_id)
       VALUES ($1, $2, $3, $4)`,
      [`mra_${suffix}`, ids.membership, ids.org, role.rows[0]!.id],
    );
    const events: Array<[string, string, string, string]> = [
      [ids.event, ids.org, `event-${suffix}`, `S${suffix.slice(0, 7)}`],
      [
        ids.otherEvent,
        ids.otherOrg,
        `other-${suffix}`,
        `T${suffix.slice(0, 7)}`,
      ],
    ];
    for (const [eventId, organizationId, slug, code] of events) {
      await pool.query(
        `INSERT INTO events
          (id, organization_id, name, slug, status, event_code, timezone, starts_at, ends_at, updated_at)
         VALUES ($1, $2, 'Summit', $3, 'DRAFT', $4, 'UTC', '2027-04-08', '2027-04-09', now())`,
        [eventId, organizationId, slug, code.toUpperCase()],
      );
    }
    await pool.query(
      `INSERT INTO event_sessions
        (id, organization_id, event_id, name, session_type, status, starts_at, ends_at, updated_at)
       VALUES ($1, $2, $3, 'Hidden', 'DAY', 'SCHEDULED', '2027-04-08', '2027-04-09', now())`,
      [ids.otherSession, ids.otherOrg, ids.otherEvent],
    );
    await app
      .get(PermissionsVersionStore, { strict: false })
      .bumpMembership(ids.membership);
  });

  beforeEach(async () => resetRateLimits());

  afterAll(async () => {
    const purge = await pool.connect();
    try {
      await purge.query('BEGIN');
      await purge.query("SET LOCAL eventini.retention_purge = 'on'");
      await purge.query(
        `DELETE FROM refresh_token_rotations
          WHERE session_id IN (SELECT id FROM user_sessions WHERE user_id = $1)`,
        [ids.user],
      );
      await purge.query(`DELETE FROM audit_logs WHERE organization_id = $1`, [
        ids.org,
      ]);
      await purge.query('COMMIT');
    } finally {
      purge.release();
    }
    await pool.query(
      `DELETE FROM event_sessions WHERE organization_id = ANY($1)`,
      [[ids.org, ids.otherOrg]],
    );
    await pool.query(`DELETE FROM events WHERE organization_id = ANY($1)`, [
      [ids.org, ids.otherOrg],
    ]);
    await pool.query(
      `DELETE FROM membership_role_assignments WHERE membership_id = $1`,
      [ids.membership],
    );
    await pool.query(`DELETE FROM user_sessions WHERE user_id = $1`, [
      ids.user,
    ]);
    await pool.query(
      `DELETE FROM organization_memberships WHERE user_id = $1`,
      [ids.user],
    );
    await pool.query(`DELETE FROM user_credentials WHERE user_id = $1`, [
      ids.user,
    ]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [ids.user]);
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1)`, [
      [ids.org, ids.otherOrg],
    ]);
    await pool.end();
    await app.close();
  });

  it('creates, lists and reads sessions only inside the tenant event', async () => {
    const { jar, csrf } = await signIn();
    const created = await createSession(jar, csrf).expect(201);
    const session = (created.body as ApiEnvelope<SessionResponse>).data!;
    expect(created.headers.etag).toBe('"1"');
    expect(session.sessionId).toMatch(/^esn_/);
    expect(session.organizationId).toBe(ids.org);
    expect(session.eventId).toBe(ids.event);
    expect(session.status).toBe('SCHEDULED');
    expect(session.requiresSeparateCheckIn).toBe(false);

    const listed = await request(server())
      .get(`/api/v1/events/${ids.event}/sessions`)
      .set('Cookie', jar)
      .expect(200);
    expect(
      (listed.body as ApiEnvelope<SessionResponse[]>).data!.map(
        (item) => item.sessionId,
      ),
    ).toContain(session.sessionId);

    await request(server())
      .get(`/api/v1/events/${ids.event}/sessions/${ids.otherSession}`)
      .set('Cookie', jar)
      .expect(404);
    await createSession(jar, csrf, ids.otherEvent).expect(404);

    const audit = await pool.query(
      `SELECT action, target_id FROM audit_logs WHERE action = 'event_session.created' AND target_id = $1`,
      [session.sessionId],
    );
    expect(audit.rows).toEqual([
      { action: 'event_session.created', target_id: session.sessionId },
    ]);
  });

  it('requires If-Match and rejects stale updates without losing data', async () => {
    const { jar, csrf } = await signIn();
    const created = await createSession(jar, csrf).expect(201);
    const session = (created.body as ApiEnvelope<SessionResponse>).data!;
    const url = `/api/v1/events/${ids.event}/sessions/${session.sessionId}`;

    await request(server())
      .patch(url)
      .set(csrf.headers(jar))
      .send({ name: 'Blind write' })
      .expect(428);
    const updated = await request(server())
      .patch(url)
      .set(csrf.headers(jar))
      .set('If-Match', '"1"')
      .send({ name: 'Updated workshop' })
      .expect(200);
    expect(updated.headers.etag).toBe('"2"');

    const stale = await request(server())
      .patch(url)
      .set(csrf.headers(jar))
      .set('If-Match', '"1"')
      .send({ name: 'Lost update' })
      .expect(409);
    expect((stale.body as ApiEnvelope<null>).error?.code).toBe(
      'VERSION_CONFLICT',
    );
  });

  it('validates session type and temporal ordering', async () => {
    const { jar, csrf } = await signIn();
    await request(server())
      .post(`/api/v1/events/${ids.event}/sessions`)
      .set(csrf.headers(jar))
      .send({
        name: 'Invalid',
        sessionType: 'MEETING',
        startsAt: '2027-04-08T11:00:00.000Z',
        endsAt: '2027-04-08T09:00:00.000Z',
      })
      .expect(400);
  });
});
