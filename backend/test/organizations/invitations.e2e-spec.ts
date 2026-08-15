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
const NEW_PASSWORD = 'another correct horse battery';

interface InvitationResponse {
  invitationId: string;
  email: string;
  status: string;
  roleCode: string;
  expiresAt: string;
  acceptedAt: string | null;
  acceptanceToken?: string;
}

/**
 * Les invitations d'organisation — EVT-043.
 *
 * Contre PostgreSQL réel, parce que tout ce qui compte ici est décidé par la
 * base : le remplacement des `PENDING`, l'atomicité de l'acceptation, et
 * l'arbitrage de deux acceptations concurrentes du même jeton. Un double de
 * repository prouverait que le code appelle les bonnes méthodes, jamais qu'un
 * échec partiel ne laisse pas un membership sans rôle.
 */
describeWithDatabase('Invitations (EVT-043)', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let names: { access: string; refresh: string };

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);
  const suffix = unique();
  const ids = {
    org: `org_i${suffix}`,
    other: `org_j${suffix}`,
    admin: `usr_a${suffix}`,
    membership: `mbr_a${suffix}`,
    outsider: `usr_o${suffix}`,
  };
  const adminEmail = `admin.${suffix}@eventini.test`;
  const outsiderEmail = `outsider.${suffix}@eventini.test`;

  const server = () => app.getHttpServer();
  const invitationsUrl = `/api/v1/organizations/${ids.org}/invitations`;
  const createdUsers: string[] = [];

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

  async function signIn(email: string): Promise<{ jar: string; csrf: Csrf }> {
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

  /** Crée une invitation et rend son jeton — le seul moment où il est lisible. */
  async function invite(
    email: string,
    roleCode = 'CLIENT_ADMIN',
  ): Promise<InvitationResponse> {
    const { jar, csrf } = await signIn(adminEmail);

    const response = await request(server())
      .post(invitationsUrl)
      .set(csrf.headers(jar))
      .send({ email, roleCode })
      .expect(201);

    return (response.body as ApiEnvelope<InvitationResponse>).data!;
  }

  /**
   * Accepte, avec ou sans session ouverte.
   *
   * Les deux cas n'utilisent pas le même jeton CSRF, et c'est ADR-0016 qui
   * l'impose : un jeton pré-session présenté à côté d'un cookie de session est
   * refusé, parce qu'à la connexion le jeton est **relié** à la session créée.
   * Le premier essai de ce test envoyait un jeton pré-session avec un cookie
   * de session et recevait 403 — la liaison faisant exactement son travail.
   */
  async function accept(
    body: Record<string, unknown>,
    session?: { jar: string; csrf: Csrf },
  ): Promise<request.Response> {
    if (session === undefined) {
      const handshake = await preSessionCsrf(app);

      return request(server())
        .post('/api/v1/auth/invitation-acceptances')
        .set(handshake.headers())
        .send(body);
    }

    return request(server())
      .post('/api/v1/auth/invitation-acceptances')
      .set(session.csrf.headers(session.jar))
      .send(body);
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
      [ids.org, `inv-${suffix}`],
      [ids.other, `oth-${suffix}`],
    ]) {
      await pool.query(
        `INSERT INTO organizations (id, name, slug, status, license_plan, is_enabled, updated_at)
         VALUES ($1, 'Inv', $2, 'ACTIVE', 'free', true, now())`,
        [id, slug],
      );
    }

    for (const [id, email] of [
      [ids.admin, adminEmail],
      [ids.outsider, outsiderEmail],
    ]) {
      await pool.query(
        `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
         VALUES ($1, $2, $2, 'In', 'Vite', 'ACTIVE', now())`,
        [id, email],
      );
      await pool.query(
        `INSERT INTO user_credentials (id, user_id, password_hash, updated_at)
         VALUES ($1, $2, $3, now())`,
        [`usr_c${unique()}`, id, hash],
      );
    }

    await pool.query(
      `INSERT INTO organization_memberships (id, user_id, organization_id, status, updated_at)
       VALUES ($1, $2, $3, 'ACTIVE', now())`,
      [ids.membership, ids.admin, ids.org],
    );

    /*
      `outsider` est membre de l'AUTRE organisation. Sans membership il ne
      pourrait pas ouvrir de session — et c'est de toute façon le scénario
      réaliste du test de session honorée : quelqu'un de connecté ailleurs qui
      ouvre un lien d'invitation qui ne lui est pas destiné.
    */
    await pool.query(
      `INSERT INTO organization_memberships (id, user_id, organization_id, status, updated_at)
       VALUES ($1, $2, $3, 'ACTIVE', now())`,
      [`mbr_o${suffix}`, ids.outsider, ids.other],
    );

    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM roles WHERE code = 'CLIENT_ADMIN'`,
    );
    await pool.query(
      `INSERT INTO membership_role_assignments (id, membership_id, organization_id, role_id)
       VALUES ($1, $2, $3, $4)`,
      [`asg_${unique()}`, ids.membership, ids.org, rows[0]!.id],
    );
    await app
      .get(PermissionsVersionStore, { strict: false })
      .bumpMembership(ids.membership);
  });

  beforeEach(async () => {
    await resetRateLimits();
  });

  afterAll(async () => {
    const everyone = [ids.admin, ids.outsider, ...createdUsers];
    const purge = await pool.connect();
    try {
      await purge.query('BEGIN');
      await purge.query("SET LOCAL eventini.retention_purge = 'on'");
      await purge.query(
        `DELETE FROM refresh_token_rotations
          WHERE session_id IN (SELECT id FROM user_sessions WHERE user_id = ANY($1))`,
        [everyone],
      );
      await purge.query('COMMIT');
    } finally {
      purge.release();
    }

    await pool.query(
      `DELETE FROM user_invitations WHERE organization_id = ANY($1)`,
      [[ids.org, ids.other]],
    );
    await pool.query(
      `DELETE FROM membership_role_assignments WHERE organization_id = ANY($1)`,
      [[ids.org, ids.other]],
    );
    await pool.query(`DELETE FROM user_sessions WHERE user_id = ANY($1)`, [
      everyone,
    ]);
    await pool.query(
      `DELETE FROM organization_memberships WHERE user_id = ANY($1)`,
      [everyone],
    );
    await pool.query(`DELETE FROM user_credentials WHERE user_id = ANY($1)`, [
      everyone,
    ]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [everyone]);
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1)`, [
      [ids.org, ids.other],
    ]);

    await pool.end();
    await app.close();
  });

  describe('création', () => {
    it('rend le jeton exactement une fois, avec une invitation PENDING', async () => {
      const invitation = await invite(`new.${unique()}@eventini.test`);

      expect(invitation.status).toBe('PENDING');
      expect(invitation.roleCode).toBe('CLIENT_ADMIN');
      expect(invitation.acceptanceToken).toEqual(expect.any(String));
      // 32 octets en base64url : jamais un identifiant, jamais devinable.
      expect(invitation.acceptanceToken!.length).toBeGreaterThan(40);
    });

    /** Le jeton n'existe qu'en empreinte : la liste ne peut pas le rendre. */
    it('ne renvoie jamais le jeton dans la liste', async () => {
      const invitation = await invite(`listed.${unique()}@eventini.test`);
      const { jar } = await signIn(adminEmail);

      const response = await request(server())
        .get(invitationsUrl)
        .set('Cookie', jar)
        .expect(200);

      expect(JSON.stringify(response.body)).not.toContain(
        invitation.acceptanceToken,
      );
      expect(JSON.stringify(response.body)).not.toContain('acceptanceToken');
    });

    /**
     * 🔴 Deux invitations `PENDING` pour une même adresse laisseraient
     * l'acceptation choisir entre deux rôles, dont un que l'invitant croyait
     * avoir remplacé.
     */
    it('bascule en REPLACED les PENDING de la même adresse', async () => {
      const email = `twice.${unique()}@eventini.test`;
      const first = await invite(email);
      await invite(email);

      const { rows } = await pool.query<{ status: string }>(
        `SELECT status FROM user_invitations WHERE id = $1`,
        [first.invitationId],
      );

      expect(rows[0]!.status).toBe('REPLACED');

      // Et l'ancien jeton ne vaut plus rien.
      const replayed = await accept({
        token: first.acceptanceToken,
        password: NEW_PASSWORD,
      });
      expect(replayed.status).toBe(404);
    });

    /**
     * Un rôle `PLATFORM` et un rôle inexistant tombent dans la même branche :
     * distinguer énumérerait le catalogue plateforme.
     */
    it.each([
      ['un rôle PLATFORM', 'SUPER_ADMIN'],
      ['un rôle inexistant', 'PAS_UN_ROLE'],
    ])('refuse %s de la même façon', async (_name, roleCode) => {
      const { jar, csrf } = await signIn(adminEmail);

      const response = await request(server())
        .post(invitationsUrl)
        .set(csrf.headers(jar))
        .send({ email: `x.${unique()}@eventini.test`, roleCode })
        .expect(400);

      const error = (response.body as ApiEnvelope<null>).error!;
      expect(error.errors[0]?.code).toBe('UNKNOWN_ROLE');
    });

    it("refuse les invitations d'une autre organisation", async () => {
      const { jar, csrf } = await signIn(adminEmail);

      await request(server())
        .post(`/api/v1/organizations/${ids.other}/invitations`)
        .set(csrf.headers(jar))
        .send({
          email: `y.${unique()}@eventini.test`,
          roleCode: 'CLIENT_ADMIN',
        })
        .expect(403);
    });
  });

  describe('révocation', () => {
    it('révoque une invitation en attente, puis la même échoue', async () => {
      const invitation = await invite(`revoked.${unique()}@eventini.test`);
      const { jar, csrf } = await signIn(adminEmail);

      await request(server())
        .delete(`${invitationsUrl}/${invitation.invitationId}`)
        .set(csrf.headers(jar))
        .expect(204);

      // REVOKED, jamais supprimée : la trace de ce qui a été tenté subsiste.
      const { rows } = await pool.query<{ status: string }>(
        `SELECT status FROM user_invitations WHERE id = $1`,
        [invitation.invitationId],
      );
      expect(rows[0]!.status).toBe('REVOKED');

      await request(server())
        .delete(`${invitationsUrl}/${invitation.invitationId}`)
        .set(csrf.headers(jar))
        .expect(404);
    });

    it('rend un jeton révoqué inutilisable', async () => {
      const invitation = await invite(`dead.${unique()}@eventini.test`);
      const { jar, csrf } = await signIn(adminEmail);

      await request(server())
        .delete(`${invitationsUrl}/${invitation.invitationId}`)
        .set(csrf.headers(jar))
        .expect(204);

      const response = await accept({
        token: invitation.acceptanceToken,
        password: NEW_PASSWORD,
      });

      expect(response.status).toBe(404);
    });
  });

  describe('acceptation', () => {
    /**
     * 🔴 Le cœur du ticket : utilisateur, membership et rôle dans une seule
     * transaction. Les trois sont vérifiés en base, pas dans la réponse.
     */
    it('crée utilisateur, membership et rôle ensemble', async () => {
      const email = `joiner.${unique()}@eventini.test`;
      const invitation = await invite(email);

      const response = await accept({
        token: invitation.acceptanceToken,
        password: NEW_PASSWORD,
      });

      expect(response.status).toBe(201);

      const { rows } = await pool.query<{
        user_id: string;
        membership_id: string;
        role_count: string;
      }>(
        `SELECT u.id AS user_id, m.id AS membership_id,
                (SELECT count(*) FROM membership_role_assignments a
                  WHERE a.membership_id = m.id AND a.revoked_at IS NULL) AS role_count
           FROM users u
           JOIN organization_memberships m
             ON m.user_id = u.id AND m.organization_id = $2
          WHERE u.normalized_email = $1`,
        [email, ids.org],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]!.role_count).toBe('1');
      createdUsers.push(rows[0]!.user_id);

      // L'invitation est consommée, et sait par qui.
      const { rows: consumed } = await pool.query<{
        status: string;
        invited_user_id: string;
      }>(`SELECT status, invited_user_id FROM user_invitations WHERE id = $1`, [
        invitation.invitationId,
      ]);
      expect(consumed[0]!.status).toBe('ACCEPTED');
      expect(consumed[0]!.invited_user_id).toBe(rows[0]!.user_id);
    });

    it('exige un mot de passe quand le compte doit être créé', async () => {
      const invitation = await invite(`nopass.${unique()}@eventini.test`);

      const response = await accept({ token: invitation.acceptanceToken });

      expect(response.status).toBe(400);
      expect((response.body as ApiEnvelope<null>).error!.errors[0]?.field).toBe(
        'password',
      );
    });

    /**
     * 🔴 Deux acceptations du même jeton n'aboutissent qu'une fois, et c'est
     * PostgreSQL qui l'arbitre — `status = 'PENDING'` est dans le `WHERE` de
     * la consommation.
     */
    it("n'aboutit qu'une fois pour un même jeton", async () => {
      const email = `once.${unique()}@eventini.test`;
      const invitation = await invite(email);

      const first = await accept({
        token: invitation.acceptanceToken,
        password: NEW_PASSWORD,
      });
      expect(first.status).toBe(201);

      const second = await accept({
        token: invitation.acceptanceToken,
        password: NEW_PASSWORD,
      });
      expect(second.status).toBe(404);

      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM organization_memberships m
           JOIN users u ON u.id = m.user_id
          WHERE u.normalized_email = $1`,
        [email],
      );
      expect(rows[0]!.count).toBe('1');

      const { rows: created } = await pool.query<{ id: string }>(
        `SELECT id FROM users WHERE normalized_email = $1`,
        [email],
      );
      createdUsers.push(created[0]!.id);
    });

    /**
     * 🔴 Session honorée. Ana, connectée, ouvre le lien destiné à Karim : sans
     * ce refus le membership atterrirait sur le compte d'Ana, et tout
     * paraîtrait avoir fonctionné.
     */
    it('refuse une acceptation faite depuis une autre session', async () => {
      const invitation = await invite(`karim.${unique()}@eventini.test`);
      const session = await signIn(outsiderEmail);

      const response = await accept(
        { token: invitation.acceptanceToken, password: NEW_PASSWORD },
        session,
      );

      expect(response.status).toBe(409);
    });

    it("accepte quand la session est bien celle de l'adresse invitée", async () => {
      // `outsider` a déjà un compte : l'invitation l'associe sans mot de passe.
      const invitation = await invite(outsiderEmail);
      const session = await signIn(outsiderEmail);

      const response = await accept(
        { token: invitation.acceptanceToken },
        session,
      );

      expect(response.status).toBe(201);
    });

    it('refuse une seconde adhésion à la même organisation', async () => {
      // `admin` est déjà membre : l'inviter à nouveau ne doit pas dupliquer.
      const invitation = await invite(adminEmail);

      const response = await accept({ token: invitation.acceptanceToken });

      expect(response.status).toBe(409);
    });

    /**
     * Jeton inconnu, expiré et déjà consommé se répondent à l'identique :
     * distinguer dirait à qui essaie des jetons au hasard lesquels ont existé.
     */
    it('répond de la même façon à un jeton inconnu', async () => {
      const response = await accept({
        token: 'x'.repeat(43),
        password: NEW_PASSWORD,
      });

      expect(response.status).toBe(404);
      expect((response.body as ApiEnvelope<null>).error!.detail).toContain(
        'no longer valid',
      );
    });

    it('refuse un jeton expiré, sans dire qu il a existé', async () => {
      const invitation = await invite(`stale.${unique()}@eventini.test`);

      await pool.query(
        `UPDATE user_invitations SET expires_at = now() - interval '1 day' WHERE id = $1`,
        [invitation.invitationId],
      );

      const response = await accept({
        token: invitation.acceptanceToken,
        password: NEW_PASSWORD,
      });

      expect(response.status).toBe(404);
    });
  });
});
