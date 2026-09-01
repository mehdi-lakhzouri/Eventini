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

interface EventResponse {
  eventId: string;
  organizationId: string;
  name: string;
  slug: string;
  status: string;
  eventCode: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
}

describeWithDatabase('Event CRUD — EVT-048', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let names: { access: string; refresh: string };

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = {
    org: `org_e${suffix}`,
    otherOrg: `org_x${suffix}`,
    user: `usr_e${suffix}`,
    membership: `mbr_e${suffix}`,
    otherEvent: `evt_x${suffix}`,
  };
  const email = `events.${suffix}@eventini.test`;

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

  function createEvent(jar: string, csrf: Csrf, slug: string) {
    return request(server())
      .post('/api/v1/events')
      .set(csrf.headers(jar))
      .send({
        name: 'Eventini Summit',
        slug,
        timezone: 'Africa/Tunis',
        startsAt: '2027-04-08T08:00:00.000Z',
        endsAt: '2027-04-08T18:00:00.000Z',
        capacity: 400,
        locationName: 'Tunis',
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
      [ids.org, `events-${suffix}`],
      [ids.otherOrg, `events-other-${suffix}`],
    ]) {
      await pool.query(
        `INSERT INTO organizations (id, name, slug, status, license_plan, is_enabled, updated_at)
         VALUES ($1, 'Events', $2, 'ACTIVE', 'free', true, now())`,
        [id, slug],
      );
    }
    await pool.query(
      `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
       VALUES ($1, $2, $2, 'Eve', 'Nts', 'ACTIVE', now())`,
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
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM roles WHERE code = 'CLIENT_ADMIN'`,
    );
    await pool.query(
      `INSERT INTO membership_role_assignments (id, membership_id, organization_id, role_id)
       VALUES ($1, $2, $3, $4)`,
      [`mra_${suffix}`, ids.membership, ids.org, rows[0]!.id],
    );
    await pool.query(
      `INSERT INTO events
        (id, organization_id, name, slug, status, event_code, timezone, starts_at, ends_at, updated_at)
       VALUES ($1, $2, 'Hidden event', $3, 'DRAFT', $4, 'UTC', now(), now() + interval '1 hour', now())`,
      [
        ids.otherEvent,
        ids.otherOrg,
        `hidden-${suffix}`,
        suffix.slice(0, 8).toUpperCase(),
      ],
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

  it('cree, liste et lit uniquement les evenements du tenant', async () => {
    const { jar, csrf } = await signIn();
    const created = await createEvent(jar, csrf, `summit-${suffix}`).expect(
      201,
    );
    const event = (created.body as ApiEnvelope<EventResponse>).data!;

    expect(event.organizationId).toBe(ids.org);
    expect(event.status).toBe('DRAFT');
    expect(event.eventCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(created.headers.etag).toBe('"1"');

    const createdAudit = await pool.query<{
      actor_user_id: string;
      organization_id: string;
    }>(
      `SELECT actor_user_id, organization_id
         FROM audit_logs
        WHERE action = 'event.created' AND target_id = $1`,
      [event.eventId],
    );
    expect(createdAudit.rows).toEqual([
      { actor_user_id: ids.user, organization_id: ids.org },
    ]);

    const listed = await request(server())
      .get('/api/v1/events')
      .set('Cookie', jar)
      .expect(200);
    const events = (listed.body as ApiEnvelope<EventResponse[]>).data!;
    expect(events.map((item) => item.eventId)).toContain(event.eventId);
    expect(events.map((item) => item.eventId)).not.toContain(ids.otherEvent);

    await request(server())
      .get(`/api/v1/events/${ids.otherEvent}`)
      .set('Cookie', jar)
      .expect(404);
  });

  it('refuse les slugs dupliques dans le tenant mais les autorise entre tenants', async () => {
    const { jar, csrf } = await signIn();
    const slug = `duplicate-${suffix}`;
    await createEvent(jar, csrf, slug).expect(201);
    const duplicate = await createEvent(jar, csrf, slug).expect(409);
    expect((duplicate.body as ApiEnvelope<null>).error?.code).toBe(
      'RESOURCE_ALREADY_EXISTS',
    );
  });

  it('valide le fuseau et les bornes temporelles', async () => {
    const { jar, csrf } = await signIn();
    await request(server())
      .post('/api/v1/events')
      .set(csrf.headers(jar))
      .send({
        name: 'Invalid',
        slug: `invalid-${suffix}`,
        timezone: 'Not/AZone',
        startsAt: '2027-04-08T18:00:00.000Z',
        endsAt: '2027-04-08T08:00:00.000Z',
      })
      .expect(400);
  });

  it('protege PATCH par If-Match et refuse une version perimee', async () => {
    const { jar, csrf } = await signIn();
    const created = await createEvent(jar, csrf, `versioned-${suffix}`).expect(
      201,
    );
    const event = (created.body as ApiEnvelope<EventResponse>).data!;
    const url = `/api/v1/events/${event.eventId}`;

    await request(server())
      .patch(url)
      .set(csrf.headers(jar))
      .send({ name: 'No precondition' })
      .expect(428);

    const updated = await request(server())
      .patch(url)
      .set(csrf.headers(jar))
      .set('If-Match', created.headers.etag as string)
      .send({ name: 'Updated summit' })
      .expect(200);
    expect((updated.body as ApiEnvelope<EventResponse>).data!.name).toBe(
      'Updated summit',
    );

    const updatedAudit = await pool.query<{ action: string }>(
      `SELECT action FROM audit_logs
        WHERE action = 'event.updated' AND target_id = $1`,
      [event.eventId],
    );
    expect(updatedAudit.rows).toEqual([{ action: 'event.updated' }]);

    const stale = await request(server())
      .patch(url)
      .set(csrf.headers(jar))
      .set('If-Match', created.headers.etag as string)
      .send({ name: 'Lost update' })
      .expect(409);
    expect((stale.body as ApiEnvelope<null>).error?.code).toBe(
      'VERSION_CONFLICT',
    );
  });

  it('exige une session pour activer puis annule avec les effets atomiques disponibles', async () => {
    const { jar, csrf } = await signIn();
    const created = await createEvent(jar, csrf, `lifecycle-${suffix}`).expect(
      201,
    );
    const event = (created.body as ApiEnvelope<EventResponse>).data!;
    const activationUrl = `/api/v1/events/${event.eventId}/activation`;

    const empty = await request(server())
      .post(activationUrl)
      .set(csrf.headers(jar))
      .set('If-Match', created.headers.etag as string)
      .expect(409);
    expect((empty.body as ApiEnvelope<null>).error?.code).toBe(
      'INVALID_STATE_TRANSITION',
    );

    const sessionId = `evs_${suffix}`;
    await pool.query(
      `INSERT INTO event_sessions
        (id, organization_id, event_id, name, session_type, status,
         starts_at, ends_at, updated_at)
       VALUES ($1, $2, $3, 'Main day', 'DAY', 'SCHEDULED',
               '2027-04-08T08:00:00Z', '2027-04-08T18:00:00Z', now())`,
      [sessionId, ids.org, event.eventId],
    );

    const activated = await request(server())
      .post(activationUrl)
      .set(csrf.headers(jar))
      .set('If-Match', created.headers.etag as string)
      .expect(201);
    expect((activated.body as ApiEnvelope<EventResponse>).data!.status).toBe(
      'ACTIVE',
    );

    const cancelled = await request(server())
      .post(`/api/v1/events/${event.eventId}/cancellation`)
      .set(csrf.headers(jar))
      .set('If-Match', activated.headers.etag as string)
      .send({ reason: 'Venue became unavailable.' })
      .expect(201);
    expect((cancelled.body as ApiEnvelope<EventResponse>).data!.status).toBe(
      'CANCELLED',
    );

    const session = await pool.query<{
      status: string;
      closed_by: string;
    }>(`SELECT status, closed_by FROM event_sessions WHERE id = $1`, [
      sessionId,
    ]);
    expect(session.rows).toEqual([{ status: 'CLOSED', closed_by: ids.user }]);

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit_logs
        WHERE target_id = $1 AND action IN ('event.activated', 'event.cancelled')
        ORDER BY occurred_at`,
      [event.eventId],
    );
    expect(audit.rows).toEqual([
      { action: 'event.activated' },
      { action: 'event.cancelled' },
    ]);
  });

  it('refuse de quitter un etat terminal', async () => {
    const { jar, csrf } = await signIn();
    const created = await createEvent(jar, csrf, `terminal-${suffix}`).expect(
      201,
    );
    const event = (created.body as ApiEnvelope<EventResponse>).data!;
    await pool.query(`UPDATE events SET status = 'EXPIRED' WHERE id = $1`, [
      event.eventId,
    ]);

    const response = await request(server())
      .post(`/api/v1/events/${event.eventId}/cancellation`)
      .set(csrf.headers(jar))
      .set('If-Match', created.headers.etag as string)
      .send({ reason: 'Too late.' })
      .expect(409);
    expect((response.body as ApiEnvelope<null>).error?.code).toBe(
      'INVALID_STATE_TRANSITION',
    );
  });
});
