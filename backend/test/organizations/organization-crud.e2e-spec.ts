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
import { csrfOf, preSessionCsrf, resetRateLimits, type Csrf } from '../helpers';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

const PASSWORD = 'correct horse battery staple';

interface OrganizationResponse {
  organizationId: string;
  name: string;
  slug: string;
  status: string;
  licensePlan: string;
  userLimit: number | null;
  eventLimit: number | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * `GET` et `PATCH /organizations/{id}` — EVT-042, et la concurrence optimiste
 * d'EVT-032 qui arrive avec, comme le ticket l'impose.
 *
 * Contre PostgreSQL réel : l'écriture versionnée vit dans le `WHERE` de la
 * requête, et c'est la base qui décide combien de lignes elle affecte. Un
 * double de repository prouverait que le code appelle la bonne méthode, jamais
 * que deux écritures concurrentes n'en perdent pas une.
 */
describeWithDatabase('GET|PATCH /api/v1/organizations/{organizationId}', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let names: { access: string; refresh: string };

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);
  const suffix = unique();
  const ids = {
    org: `org_c${suffix}`,
    other: `org_o${suffix}`,
    user: `usr_c${suffix}`,
    membership: `mbr_c${suffix}`,
  };
  const email = `crud.${suffix}@eventini.test`;
  const initialSlug = `crud-${suffix}`;

  const server = () => app.getHttpServer();
  const url = `/api/v1/organizations/${ids.org}`;

  function cookieValue(response: request.Response, name: string): string {
    const cookies = (response.headers['set-cookie'] ??
      []) as unknown as string[];

    return cookies
      .map((cookie) => {
        const [pair] = cookie.split(';');

        return pair?.startsWith(`${name}=`)
          ? pair.slice(name.length + 1)
          : undefined;
      })
      .find((value): value is string => value !== undefined) as string;
  }

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

  /** Lit l'organisation et rend son `ETag`, comme le ferait un vrai client. */
  async function readETag(jar: string): Promise<string> {
    const response = await request(server())
      .get(url)
      .set('Cookie', jar)
      .expect(200);

    return response.headers.etag as string;
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

    const hash = await app
      .get(PasswordHasher, { strict: false })
      .hash(PASSWORD);

    pool = new Pool({ connectionString: DATABASE_URL, max: 3 });
    pool.on('error', () => undefined);

    for (const [id, slug] of [
      [ids.org, initialSlug],
      // Une seconde organisation, réelle et vivante, dont le slug est pris.
      [ids.other, `taken-${suffix}`],
    ]) {
      await pool.query(
        `INSERT INTO organizations (id, name, slug, status, license_plan, is_enabled, updated_at)
         VALUES ($1, 'Crud', $2, 'ACTIVE', 'free', true, now())`,
        [id, slug],
      );
    }

    await pool.query(
      `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
       VALUES ($1, $2, $2, 'Cy', 'Rud', 'ACTIVE', now())`,
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
    await app
      .get(PermissionsVersionStore, { strict: false })
      .bumpMembership(ids.membership);
  });

  beforeEach(async () => {
    await resetRateLimits();
    // Chaque cas repart du même nom et du même slug : les tests s'exécutent en
    // série et une écriture réussie change la version pour les suivants.
    await pool.query(
      `UPDATE organizations SET name = 'Crud', slug = $2 WHERE id = $1`,
      [ids.org, initialSlug],
    );
  });

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
      await purge.query('COMMIT');
    } finally {
      purge.release();
    }

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
      [ids.org, ids.other],
    ]);

    await pool.end();
    await app.close();
  });

  describe('GET', () => {
    it('renvoie le profil et pose un ETag', async () => {
      const { jar } = await signIn();

      const response = await request(server())
        .get(url)
        .set('Cookie', jar)
        .expect(200);

      const body = (response.body as ApiEnvelope<OrganizationResponse>).data!;

      expect(body.organizationId).toBe(ids.org);
      expect(body.slug).toBe(initialSlug);
      expect(body.status).toBe('ACTIVE');
      expect(response.headers.etag).toMatch(/^"\d+"$/);
    });

    /**
     * La version voyage dans l'`ETag`, pas dans le corps. La republier
     * inviterait un client à la comparer lui-même plutôt qu'à renvoyer
     * l'en-tête, et les deux finiraient par diverger.
     */
    it("n'expose ni version ni colonnes d'audit dans le corps", async () => {
      const { jar } = await signIn();

      const response = await request(server())
        .get(url)
        .set('Cookie', jar)
        .expect(200);

      const raw = JSON.stringify((response.body as ApiEnvelope<unknown>).data);

      expect(raw).not.toContain('version');
      expect(raw).not.toContain('createdBy');
      expect(raw).not.toContain('updatedBy');
      expect(raw).not.toContain('deletedAt');
    });

    it("refuse l'organisation d'un autre tenant", async () => {
      const { jar } = await signIn();

      await request(server())
        .get(`/api/v1/organizations/${ids.other}`)
        .set('Cookie', jar)
        .expect(403);
    });
  });

  describe('PATCH — concurrence optimiste', () => {
    /**
     * 🔴 Le cas central d'EVT-032. Sans `If-Match`, deux administrateurs
     * éditant la même organisation s'écrasent en silence.
     */
    it('répond 428 quand If-Match est absent', async () => {
      const { jar, csrf } = await signIn();

      const response = await request(server())
        .patch(url)
        .set(csrf.headers(jar))
        .send({ name: 'Sans précondition' })
        .expect(428);

      expect((response.body as ApiEnvelope<null>).error?.code).toBe(
        'PRECONDITION_REQUIRED',
      );
    });

    it('répond 412 sur un If-Match malformé', async () => {
      const { jar, csrf } = await signIn();

      await request(server())
        .patch(url)
        .set(csrf.headers(jar))
        .set('If-Match', 'pas-une-etiquette')
        .send({ name: 'Malformé' })
        .expect(412);
    });

    /**
     * `*` est du HTTP valide et signifie « quelle que soit la version
     * actuelle ». L'accepter donnerait à tout appelant une façon documentée de
     * renoncer à la garantie que cette route existe pour offrir.
     */
    it('refuse If-Match: *', async () => {
      const { jar, csrf } = await signIn();

      await request(server())
        .patch(url)
        .set(csrf.headers(jar))
        .set('If-Match', '*')
        .send({ name: 'Joker' })
        .expect(428);
    });

    it('applique le changement et renvoie le nouvel ETag', async () => {
      const { jar, csrf } = await signIn();
      const etag = await readETag(jar);

      const response = await request(server())
        .patch(url)
        .set(csrf.headers(jar))
        .set('If-Match', etag)
        .send({ name: 'Congrès renommé' })
        .expect(200);

      const body = (response.body as ApiEnvelope<OrganizationResponse>).data!;

      expect(body.name).toBe('Congrès renommé');
      // La version a avancé : renvoyer l'ancien ETag doit désormais échouer.
      expect(response.headers.etag).not.toBe(etag);
    });

    /**
     * 🔴 Le scénario que tout ceci empêche : deux administrateurs lisent la
     * même version, tous deux écrivent, et le second ne doit pas gagner en
     * silence.
     */
    it('refuse la seconde de deux écritures concurrentes', async () => {
      const { jar, csrf } = await signIn();
      const etag = await readETag(jar);

      await request(server())
        .patch(url)
        .set(csrf.headers(jar))
        .set('If-Match', etag)
        .send({ name: 'Premier arrivé' })
        .expect(200);

      const second = await request(server())
        .patch(url)
        .set(csrf.headers(jar))
        // Le même ETag : ce que le second administrateur avait en main.
        .set('If-Match', etag)
        .send({ name: 'Second arrivé' })
        .expect(409);

      expect((second.body as ApiEnvelope<null>).error?.code).toBe(
        'VERSION_CONFLICT',
      );

      // Et le travail du premier est intact.
      const after = await request(server())
        .get(url)
        .set('Cookie', jar)
        .expect(200);

      expect((after.body as ApiEnvelope<OrganizationResponse>).data!.name).toBe(
        'Premier arrivé',
      );
    });
  });

  describe('PATCH — champs', () => {
    /**
     * Ces cinq champs sont des attributs plateforme. Ils ne sont pas ignorés
     * mais refusés : ignorer laisserait un administrateur croire qu'il vient
     * de relever sa limite d'utilisateurs.
     */
    it.each([
      ['status', { status: 'SUSPENDED' }],
      ['isEnabled', { isEnabled: false }],
      ['licensePlan', { licensePlan: 'enterprise' }],
      ['userLimit', { userLimit: 9999 }],
      ['eventLimit', { eventLimit: 9999 }],
    ])('refuse %s, attribut plateforme', async (_field, payload) => {
      const { jar, csrf } = await signIn();
      const etag = await readETag(jar);

      await request(server())
        .patch(url)
        .set(csrf.headers(jar))
        .set('If-Match', etag)
        .send(payload)
        .expect(400);
    });

    it('refuse un corps sans aucun champ modifiable', async () => {
      const { jar, csrf } = await signIn();
      const etag = await readETag(jar);

      // Accepté, il incrémenterait la version et invaliderait l'ETag de tous
      // les autres lecteurs pour un changement qui n'a pas eu lieu.
      await request(server())
        .patch(url)
        .set(csrf.headers(jar))
        .set('If-Match', etag)
        .send({})
        .expect(400);
    });

    it.each([
      ['des majuscules', 'Congres-Alpha'],
      ['un tiret en tête', '-alpha'],
      ['deux tirets consécutifs', 'alpha--beta'],
      ['un caractère interdit', 'alpha_beta'],
      ['trop court', 'ab'],
      ['un segment réservé', 'admin'],
    ])('refuse un slug avec %s', async (_name, slug) => {
      const { jar, csrf } = await signIn();
      const etag = await readETag(jar);

      await request(server())
        .patch(url)
        .set(csrf.headers(jar))
        .set('If-Match', etag)
        .send({ slug })
        .expect(400);
    });

    /**
     * Le slug pris appartient à une organisation que l'appelant n'a pas le
     * droit de voir. Le refus ne la nomme pas, sans quoi cette route
     * deviendrait un moyen d'énumérer les organisations de la plateforme.
     */
    it('répond 409 sur un slug déjà pris, sans nommer son propriétaire', async () => {
      const { jar, csrf } = await signIn();
      const etag = await readETag(jar);

      const response = await request(server())
        .patch(url)
        .set(csrf.headers(jar))
        .set('If-Match', etag)
        .send({ slug: `taken-${suffix}` })
        .expect(409);

      const error = (response.body as ApiEnvelope<null>).error!;

      expect(error.code).toBe('RESOURCE_ALREADY_EXISTS');
      expect(JSON.stringify(error)).not.toContain(ids.other);
    });

    it('accepte un slug valide et libre', async () => {
      const { jar, csrf } = await signIn();
      const etag = await readETag(jar);

      const response = await request(server())
        .patch(url)
        .set(csrf.headers(jar))
        .set('If-Match', etag)
        .send({ slug: `libre-${suffix}` })
        .expect(200);

      expect(
        (response.body as ApiEnvelope<OrganizationResponse>).data!.slug,
      ).toBe(`libre-${suffix}`);
    });
  });
});
