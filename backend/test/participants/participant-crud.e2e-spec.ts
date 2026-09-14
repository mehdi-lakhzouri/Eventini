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

interface ParticipantResponse {
  participantId: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  participantType: string;
  country: string | null;
  possibleDuplicateCount: number;
  possibleDuplicateIds?: string[];
}

interface Session {
  jar: string;
  csrf: Csrf;
}

describeWithDatabase('Participant CRUD — EVT-054', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let names: { access: string; refresh: string };

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = {
    org: `org_p${suffix}`,
    otherOrg: `org_q${suffix}`,
    admin: `usr_p${suffix}`,
    adminMembership: `mbr_p${suffix}`,
    reader: `usr_r${suffix}`,
    readerMembership: `mbr_r${suffix}`,
    otherParticipant: `par_q${suffix}`,
  };
  const emails = {
    admin: `participants.${suffix}@eventini.test`,
    reader: `no-role.${suffix}@eventini.test`,
    shared: `shared.${suffix}@eventini.test`,
  };

  const server = () => app.getHttpServer();

  async function signIn(email: string): Promise<Session> {
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

  function createParticipant(session: Session, body: Record<string, unknown>) {
    return request(server())
      .post('/api/v1/participants')
      .set(session.csrf.headers(session.jar))
      .send(body);
  }

  function list(session: Session, query: Record<string, unknown>) {
    return request(server())
      .get('/api/v1/participants')
      .query(query)
      .set('Cookie', session.jar);
  }

  const dataOf = <T>(response: request.Response): T =>
    (response.body as ApiEnvelope<T>).data!;
  const errorOf = (response: request.Response) =>
    (response.body as ApiEnvelope<null>).error!;

  async function seedUser(
    userId: string,
    email: string,
    membershipId: string,
    hash: string,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
       VALUES ($1, $2, $2, 'Par', 'Ticipant', 'ACTIVE', now())`,
      [userId, email],
    );
    await pool.query(
      `INSERT INTO user_credentials (id, user_id, password_hash, updated_at)
       VALUES ($1, $2, $3, now())`,
      [`cred_${userId}`, userId, hash],
    );
    await pool.query(
      `INSERT INTO organization_memberships (id, user_id, organization_id, status, updated_at)
       VALUES ($1, $2, $3, 'ACTIVE', now())`,
      [membershipId, userId, ids.org],
    );
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
      [ids.org, `participants-${suffix}`],
      [ids.otherOrg, `participants-other-${suffix}`],
    ]) {
      await pool.query(
        `INSERT INTO organizations (id, name, slug, status, license_plan, is_enabled, updated_at)
         VALUES ($1, 'Participants', $2, 'ACTIVE', 'free', true, now())`,
        [id, slug],
      );
    }

    await seedUser(ids.admin, emails.admin, ids.adminMembership, hash);
    await seedUser(ids.reader, emails.reader, ids.readerMembership, hash);

    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM roles WHERE code = 'CLIENT_ADMIN'`,
    );
    await pool.query(
      `INSERT INTO membership_role_assignments (id, membership_id, organization_id, role_id)
       VALUES ($1, $2, $3, $4)`,
      [`mra_${suffix}`, ids.adminMembership, ids.org, rows[0]!.id],
    );

    // Another client's participant, sharing an address used below.
    await pool.query(
      `INSERT INTO participants
         (id, organization_id, first_name, last_name, email, normalized_email,
          participant_type, dedup_fingerprint, updated_at)
       VALUES ($1, $2, 'Hidden', 'Person', $3, $3, 'STANDARD', 'fp', now())`,
      [ids.otherParticipant, ids.otherOrg, emails.shared],
    );

    const versions = app.get(PermissionsVersionStore, { strict: false });
    await versions.bumpMembership(ids.adminMembership);
    await versions.bumpMembership(ids.readerMembership);
  });

  beforeEach(async () => resetRateLimits());

  afterAll(async () => {
    const purge = await pool.connect();
    try {
      await purge.query('BEGIN');
      await purge.query("SET LOCAL eventini.retention_purge = 'on'");
      await purge.query(
        `DELETE FROM refresh_token_rotations
          WHERE session_id IN (SELECT id FROM user_sessions WHERE user_id = ANY($1))`,
        [[ids.admin, ids.reader]],
      );
      await purge.query(`DELETE FROM audit_logs WHERE organization_id = $1`, [
        ids.org,
      ]);
      await purge.query('COMMIT');
    } finally {
      purge.release();
    }
    await pool.query(
      `DELETE FROM participants WHERE organization_id = ANY($1)`,
      [[ids.org, ids.otherOrg]],
    );
    await pool.query(
      `DELETE FROM membership_role_assignments WHERE membership_id = $1`,
      [ids.adminMembership],
    );
    await pool.query(`DELETE FROM user_sessions WHERE user_id = ANY($1)`, [
      [ids.admin, ids.reader],
    ]);
    await pool.query(
      `DELETE FROM organization_memberships WHERE user_id = ANY($1)`,
      [[ids.admin, ids.reader]],
    );
    await pool.query(`DELETE FROM user_credentials WHERE user_id = ANY($1)`, [
      [ids.admin, ids.reader],
    ]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [
      [ids.admin, ids.reader],
    ]);
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1)`, [
      [ids.org, ids.otherOrg],
    ]);
    await pool.end();
    await app.close();
  });

  it('cree, lit et liste uniquement les participants du tenant', async () => {
    const admin = await signIn(emails.admin);
    const created = await createParticipant(admin, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'Ada.Lovelace@Example.com',
      phone: '+447700900123',
      country: 'gb',
      participantType: 'SPEAKER',
      metadata: { badge: 'blue' },
    }).expect(201);
    const participant = dataOf<ParticipantResponse>(created);

    expect(participant.participantId).toMatch(/^par_/);
    expect(participant.organizationId).toBe(ids.org);
    expect(participant.country).toBe('GB');
    expect(participant.possibleDuplicateIds).toEqual([]);
    expect(created.headers.etag).toBe('"1"');
    expect(created.headers.location).toBe(
      `/api/v1/participants/${participant.participantId}`,
    );

    const stored = await pool.query<{
      normalized_email: string;
      dedup_fingerprint: string;
    }>(
      `SELECT normalized_email, dedup_fingerprint FROM participants WHERE id = $1`,
      [participant.participantId],
    );
    expect(stored.rows[0]?.normalized_email).toBe('ada.lovelace@example.com');
    expect(stored.rows[0]?.dedup_fingerprint).toMatch(/^[0-9a-f]{64}$/);

    // The audit entry names what was provided, never the personal data itself.
    const audit = await pool.query<{
      actor_user_id: string;
      new_values: unknown;
    }>(
      `SELECT actor_user_id, new_values FROM audit_logs
        WHERE action = 'participant.created' AND target_id = $1`,
      [participant.participantId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.actor_user_id).toBe(ids.admin);
    const auditText = JSON.stringify(audit.rows[0]?.new_values);
    expect(auditText).not.toMatch(/lovelace|ada|447700900123/i);
    expect(audit.rows[0]?.new_values).toMatchObject({
      participantType: 'SPEAKER',
      providedFields: ['email', 'phone', 'country'],
    });

    const detail = await request(server())
      .get(`/api/v1/participants/${participant.participantId}`)
      .set('Cookie', admin.jar)
      .expect(200);
    expect(dataOf<ParticipantResponse>(detail).email).toBe(
      'Ada.Lovelace@Example.com',
    );
    expect(detail.headers.etag).toBe('"1"');

    const listed = await list(admin, { limit: 100 }).expect(200);
    const listedIds = dataOf<ParticipantResponse[]>(listed).map(
      (item) => item.participantId,
    );
    expect(listedIds).toContain(participant.participantId);
    expect(listedIds).not.toContain(ids.otherParticipant);
    expect((listed.body as ApiEnvelope<unknown>).meta.pagination).toMatchObject(
      { limit: 100, hasPreviousPage: false },
    );
  });

  it("ne revele rien du participant d'un autre tenant", async () => {
    const admin = await signIn(emails.admin);
    const url = `/api/v1/participants/${ids.otherParticipant}`;

    await request(server()).get(url).set('Cookie', admin.jar).expect(404);
    await request(server())
      .patch(url)
      .set(admin.csrf.headers(admin.jar))
      .set('If-Match', '"1"')
      .send({ firstName: 'Taken over' })
      .expect(404);
    await request(server())
      .delete(url)
      .set(admin.csrf.headers(admin.jar))
      .expect(404);

    const untouched = await pool.query<{
      first_name: string;
      deleted_at: Date | null;
    }>(`SELECT first_name, deleted_at FROM participants WHERE id = $1`, [
      ids.otherParticipant,
    ]);
    expect(untouched.rows).toEqual([
      { first_name: 'Hidden', deleted_at: null },
    ]);
  });

  it("impose l'unicite de l'email par organisation, jamais globalement", async () => {
    const admin = await signIn(emails.admin);

    // Already used by the other organization's participant: accepted here.
    await createParticipant(admin, {
      firstName: 'Shared',
      lastName: 'Address',
      email: emails.shared,
    }).expect(201);

    const duplicate = await createParticipant(admin, {
      firstName: 'Other',
      lastName: 'Person',
      email: emails.shared.toUpperCase(),
    }).expect(409);
    expect(errorOf(duplicate).code).toBe('RESOURCE_ALREADY_EXISTS');
    expect(errorOf(duplicate).errors).toEqual([
      expect.objectContaining({ field: 'email' }),
    ]);

    await createParticipant(admin, {
      firstName: 'Walk',
      lastName: `In ${suffix}`,
    }).expect(201);
    await createParticipant(admin, {
      firstName: 'Another',
      lastName: `Walk-in ${suffix}`,
    }).expect(201);
  });

  it('signale un doublon probable sans jamais fusionner', async () => {
    const admin = await signIn(emails.admin);
    const lastName = `Ben Ali ${suffix}`;

    const first = dataOf<ParticipantResponse>(
      await createParticipant(admin, {
        firstName: 'Sami',
        lastName,
        phone: '+21620123456',
      }).expect(201),
    );
    const second = dataOf<ParticipantResponse>(
      await createParticipant(admin, {
        firstName: 'SAMI',
        lastName: lastName.replace(' ', '-').toLowerCase(),
        phone: '+21620123456',
      }).expect(201),
    );

    expect(first.possibleDuplicateIds).toEqual([]);
    expect(second.possibleDuplicateIds).toEqual([first.participantId]);
    expect(second.possibleDuplicateCount).toBe(1);

    const firstAgain = dataOf<ParticipantResponse>(
      await request(server())
        .get(`/api/v1/participants/${first.participantId}`)
        .set('Cookie', admin.jar)
        .expect(200),
    );
    expect(firstAgain.possibleDuplicateIds).toEqual([second.participantId]);

    const listed = dataOf<ParticipantResponse[]>(
      await list(admin, { search: suffix, limit: 100 }).expect(200),
    );
    const pair = listed.filter((item) =>
      [first.participantId, second.participantId].includes(item.participantId),
    );
    expect(pair.map((item) => item.possibleDuplicateCount)).toEqual([1, 1]);

    const rows = await pool.query(
      `SELECT id FROM participants WHERE id = ANY($1) AND deleted_at IS NULL`,
      [[first.participantId, second.participantId]],
    );
    expect(rows.rowCount).toBe(2);
  });

  it('protege PATCH par If-Match et recalcule les cles derivees', async () => {
    const admin = await signIn(emails.admin);
    const taken = `taken.${suffix}@eventini.test`;
    await createParticipant(admin, {
      firstName: 'Taken',
      lastName: 'Email',
      email: taken,
    }).expect(201);
    const created = await createParticipant(admin, {
      firstName: 'Grace',
      lastName: 'Hopper',
      email: `grace.${suffix}@eventini.test`,
    }).expect(201);
    const participant = dataOf<ParticipantResponse>(created);
    const url = `/api/v1/participants/${participant.participantId}`;
    const before = await pool.query<{ dedup_fingerprint: string }>(
      `SELECT dedup_fingerprint FROM participants WHERE id = $1`,
      [participant.participantId],
    );

    const missing = await request(server())
      .patch(url)
      .set(admin.csrf.headers(admin.jar))
      .send({ jobTitle: 'Rear admiral' })
      .expect(428);
    expect(errorOf(missing).code).toBe('PRECONDITION_REQUIRED');

    const updated = await request(server())
      .patch(url)
      .set(admin.csrf.headers(admin.jar))
      .set('If-Match', created.headers.etag as string)
      .send({ email: `GRACE.NEW.${suffix}@eventini.test` })
      .expect(200);
    expect(updated.headers.etag).toBe('"2"');

    const after = await pool.query<{
      normalized_email: string;
      dedup_fingerprint: string;
    }>(
      `SELECT normalized_email, dedup_fingerprint FROM participants WHERE id = $1`,
      [participant.participantId],
    );
    expect(after.rows[0]?.normalized_email).toBe(
      `grace.new.${suffix}@eventini.test`,
    );
    expect(after.rows[0]?.dedup_fingerprint).not.toBe(
      before.rows[0]?.dedup_fingerprint,
    );

    const audit = await pool.query<{ new_values: unknown }>(
      `SELECT new_values FROM audit_logs
        WHERE action = 'participant.updated' AND target_id = $1`,
      [participant.participantId],
    );
    expect(audit.rows).toEqual([{ new_values: { changedFields: ['email'] } }]);

    const stale = await request(server())
      .patch(url)
      .set(admin.csrf.headers(admin.jar))
      .set('If-Match', created.headers.etag as string)
      .send({ jobTitle: 'Lost update' })
      .expect(409);
    expect(errorOf(stale).code).toBe('VERSION_CONFLICT');

    const collision = await request(server())
      .patch(url)
      .set(admin.csrf.headers(admin.jar))
      .set('If-Match', updated.headers.etag as string)
      .send({ email: taken })
      .expect(409);
    expect(errorOf(collision).code).toBe('RESOURCE_ALREADY_EXISTS');

    for (const body of [{}, { firstName: null }, { participantType: null }]) {
      await request(server())
        .patch(url)
        .set(admin.csrf.headers(admin.jar))
        .set('If-Match', updated.headers.etag as string)
        .send(body)
        .expect(400);
    }
  });

  it("supprime logiquement, repond 204 a chaque repetition et libere l'email", async () => {
    const admin = await signIn(emails.admin);
    const email = `removed.${suffix}@eventini.test`;
    const participant = dataOf<ParticipantResponse>(
      await createParticipant(admin, {
        firstName: 'To',
        lastName: 'Remove',
        email,
      }).expect(201),
    );
    const url = `/api/v1/participants/${participant.participantId}`;

    await request(server())
      .delete(url)
      .set(admin.csrf.headers(admin.jar))
      .send({ reason: 'Registered by mistake.' })
      .expect(204);
    await request(server())
      .delete(url)
      .set(admin.csrf.headers(admin.jar))
      .expect(204);

    await request(server()).get(url).set('Cookie', admin.jar).expect(404);
    const listed = dataOf<ParticipantResponse[]>(
      await list(admin, { search: 'remove', limit: 100 }).expect(200),
    );
    expect(listed.map((item) => item.participantId)).not.toContain(
      participant.participantId,
    );

    const row = await pool.query<{
      deleted_by: string;
      deletion_reason: string;
    }>(
      `SELECT deleted_by, deletion_reason FROM participants
        WHERE id = $1 AND deleted_at IS NOT NULL`,
      [participant.participantId],
    );
    expect(row.rows).toEqual([
      { deleted_by: ids.admin, deletion_reason: 'Registered by mistake.' },
    ]);

    const audit = await pool.query(
      `SELECT id FROM audit_logs
        WHERE action = 'participant.deleted' AND target_id = $1`,
      [participant.participantId],
    );
    expect(audit.rowCount).toBe(1);

    await createParticipant(admin, {
      firstName: 'To',
      lastName: 'Remove',
      email,
    }).expect(201);
  });

  it('pagine par curseur signe, sans doublon ni omission sur des horodatages identiques', async () => {
    const admin = await signIn(emails.admin);
    const marker = `pager${suffix}`;
    const created: string[] = [];

    for (let index = 0; index < 5; index += 1) {
      const participant = dataOf<ParticipantResponse>(
        await createParticipant(admin, {
          firstName: 'Page',
          lastName: `${marker} ${index}`,
        }).expect(201),
      );
      created.push(participant.participantId);
    }
    await pool.query(
      `UPDATE participants SET created_at = '2027-01-01T00:00:00Z' WHERE id = ANY($1)`,
      [created],
    );

    const seen: string[] = [];
    const pages: request.Response[] = [];
    let after: string | undefined;

    do {
      const page = await list(admin, {
        search: marker,
        limit: 2,
        ...(after === undefined ? {} : { after }),
      }).expect(200);
      pages.push(page);
      seen.push(
        ...dataOf<ParticipantResponse[]>(page).map(
          (item) => item.participantId,
        ),
      );
      after =
        (page.body as ApiEnvelope<unknown>).meta.pagination?.nextCursor ??
        undefined;
    } while (after !== undefined);

    expect(pages.map((page) => dataOf<unknown[]>(page).length)).toEqual([
      2, 2, 1,
    ]);
    expect([...seen].sort()).toEqual([...created].sort());
    expect(new Set(seen).size).toBe(5);
    // Identical timestamps: the id tie-breaker decides, descending.
    expect(seen).toEqual([...created].sort().reverse());

    const lastPage = (pages[2]!.body as ApiEnvelope<unknown>).meta.pagination!;
    expect(lastPage).toMatchObject({
      hasNextPage: false,
      hasPreviousPage: true,
      nextCursor: null,
    });

    const back = await list(admin, {
      search: marker,
      limit: 2,
      before: lastPage.previousCursor,
    }).expect(200);
    expect(
      dataOf<ParticipantResponse[]>(back).map((item) => item.participantId),
    ).toEqual(seen.slice(2, 4));
    expect((back.body as ApiEnvelope<unknown>).meta.pagination).toMatchObject({
      hasNextPage: true,
      hasPreviousPage: true,
    });

    const byName = dataOf<ParticipantResponse[]>(
      await list(admin, {
        search: marker,
        sortBy: 'lastName',
        sortOrder: 'asc',
        limit: 100,
      }).expect(200),
    );
    expect(byName.map((item) => item.lastName)).toEqual(
      [0, 1, 2, 3, 4].map((index) => `${marker} ${index}`),
    );
  });

  it('refuse un curseur trafique, perime ou hors contexte, et les parametres hors bornes', async () => {
    const admin = await signIn(emails.admin);
    for (const firstName of ['Cursor', 'Holder']) {
      await createParticipant(admin, { firstName, lastName: 'Page' }).expect(
        201,
      );
    }
    const first = await list(admin, { limit: 1 }).expect(200);
    const cursor = (first.body as ApiEnvelope<unknown>).meta.pagination!
      .nextCursor!;
    expect(cursor).toEqual(expect.any(String));

    const [body, signature] = cursor.split('.');
    const forged = Buffer.from(
      JSON.stringify({
        ...(JSON.parse(Buffer.from(body!, 'base64url').toString()) as object),
        k: ['1970-01-01T00:00:00.000Z', 'par_0'],
      }),
    ).toString('base64url');

    const refused: Record<string, unknown>[] = [
      { after: `${forged}.${signature}` },
      { after: 'not-a-cursor' },
      { after: cursor, sortBy: 'lastName' },
      { after: cursor, search: 'changed' },
      { after: cursor, participantType: 'VIP' },
      { after: cursor, before: cursor },
      { limit: 5000 },
      { limit: 0 },
      { limit: 'ten' },
      { search: 'a' },
      { search: '   a  ' },
      { search: 'x'.repeat(101) },
      { sortBy: 'email' },
      { participantType: 'GUEST' },
    ];

    for (const query of refused) {
      const response = await list(admin, query);
      expect({ query, status: response.status }).toEqual({
        query,
        status: 400,
      });
      expect(errorOf(response).code).toBe('VALIDATION_ERROR');
    }

    // The same cursor, same query: still accepted.
    await list(admin, { limit: 1, after: cursor }).expect(200);

    // A tenant named by the client is never used to scope — it is compared
    // with the session's, and a divergence is refused before validation.
    const foreign = await list(admin, { organizationId: ids.otherOrg }).expect(
      403,
    );
    expect(errorOf(foreign).code).toBe('AUTH_TENANT_DENIED');
  });

  it('filtre par type et traite la recherche comme du texte', async () => {
    const admin = await signIn(emails.admin);
    const marker = `filter${suffix}`;

    for (const participantType of ['SPEAKER', 'VIP', 'STAFF']) {
      await createParticipant(admin, {
        firstName: 'Typed',
        lastName: `${marker} ${participantType}`,
        participantType,
      }).expect(201);
    }

    const typed = dataOf<ParticipantResponse[]>(
      await request(server())
        .get(
          `/api/v1/participants?search=${marker}&participantType=SPEAKER&participantType=VIP`,
        )
        .set('Cookie', admin.jar)
        .expect(200),
    );
    expect(typed.map((item) => item.participantType).sort()).toEqual([
      'SPEAKER',
      'VIP',
    ]);

    // `%` and `_` are LIKE wildcards; searched for, they are plain text.
    const literal = dataOf<ParticipantResponse>(
      await createParticipant(admin, {
        firstName: 'Literal',
        lastName: `Rate 100%_${marker}`,
      }).expect(201),
    );
    const wildcard = dataOf<ParticipantResponse[]>(
      await list(admin, { search: '%%', limit: 100 }).expect(200),
    );
    expect(wildcard).toEqual([]);
    const escaped = dataOf<ParticipantResponse[]>(
      await list(admin, { search: '0%_', limit: 100 }).expect(200),
    );
    expect(escaped.map((item) => item.participantId)).toEqual([
      literal.participantId,
    ]);
  });

  it('refuse les champs non declares et un membre sans participants.read', async () => {
    const admin = await signIn(emails.admin);

    const foreignTenant = await createParticipant(admin, {
      firstName: 'Mass',
      lastName: `Assignment ${suffix}`,
      organizationId: ids.otherOrg,
    }).expect(403);
    expect(errorOf(foreignTenant).code).toBe('AUTH_TENANT_DENIED');

    const massAssignment = await createParticipant(admin, {
      firstName: 'Mass',
      lastName: `Assignment ${suffix}`,
      dedupFingerprint: 'chosen-by-client',
    }).expect(400);
    expect(errorOf(massAssignment).code).toBe('VALIDATION_ERROR');

    const planted = await pool.query(
      `SELECT id FROM participants WHERE last_name = $1`,
      [`Assignment ${suffix}`],
    );
    expect(planted.rowCount).toBe(0);

    for (const body of [
      { firstName: '   ', lastName: 'Blank' },
      { firstName: 'Bad', lastName: 'Phone', phone: '0612345678' },
      { firstName: 'Bad', lastName: 'Country', country: 'XX' },
      { firstName: 'Bad', lastName: 'Email', email: 'not-an-email' },
      { firstName: 'Bad', lastName: 'Type', participantType: 'GUEST' },
      {
        firstName: 'Big',
        lastName: 'Metadata',
        metadata: { blob: 'x'.repeat(9_000) },
      },
    ]) {
      await createParticipant(admin, body).expect(400);
    }

    const reader = await signIn(emails.reader);
    const denied = await list(reader, {}).expect(403);
    expect(errorOf(denied).code).toBe('AUTH_PERMISSION_DENIED');
    await createParticipant(reader, {
      firstName: 'No',
      lastName: 'Permission',
    }).expect(403);
  });
});
