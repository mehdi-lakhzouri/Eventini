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

interface MemberResponse {
  membershipId: string;
  userId: string;
  email: string;
  status: string;
  mfaEnabled: boolean;
  roleCodes: string[];
}

/**
 * Membres et assignation de rôles — EVT-044.
 *
 * Contre PostgreSQL et Redis réels. Trois garanties de ce ticket ne sont
 * tenues par personne d'autre : le trigger INV-09, l'atomicité de la
 * transaction, et surtout le fait qu'une révocation prenne effet **sur le même
 * jeton d'accès** — ce qui dépend du compteur Redis incrémenté au bon moment.
 *
 * 🔴 Le catalogue seedé ne contient qu'**un seul** rôle de portée
 * `ORGANIZATION` : `CLIENT_ADMIN`. `EVENT_ADMIN`, `REPORT_VIEWER`, `SCANNER` et
 * `SESSION_MANAGER` sont de portée `EVENT` et s'accordent par
 * `event_user_assignments`, pas ici ; `SUPER_ADMIN` est `PLATFORM`. Cette
 * route n'a donc, aujourd'hui, qu'un rôle à donner — et les tests ci-dessous
 * le reflètent au lieu de faire semblant du contraire.
 */
describeWithDatabase('Members and roles (EVT-044)', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let names: { access: string; refresh: string };

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);
  const suffix = unique();
  const ids = {
    org: `org_m${suffix}`,
    admin: `usr_m${suffix}`,
    adminMembership: `mbr_m${suffix}`,
    member: `usr_n${suffix}`,
    memberMembership: `mbr_n${suffix}`,
  };
  const adminEmail = `mgr.${suffix}@eventini.test`;
  const memberEmail = `mbr.${suffix}@eventini.test`;

  const server = () => app.getHttpServer();
  const membersUrl = `/api/v1/organizations/${ids.org}/members`;

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

  async function setRoles(
    session: { jar: string; csrf: Csrf },
    membershipId: string,
    roleCodes: string[],
  ) {
    return request(server())
      .put(`${membersUrl}/${membershipId}/roles`)
      .set(session.csrf.headers(session.jar))
      .send({ roleCodes });
  }

  async function activeRoleCodes(membershipId: string): Promise<string[]> {
    const { rows } = await pool.query<{ code: string }>(
      `SELECT r.code
         FROM membership_role_assignments a
         JOIN roles r ON r.id = a.role_id
        WHERE a.membership_id = $1 AND a.revoked_at IS NULL
        ORDER BY r.code`,
      [membershipId],
    );

    return rows.map((row) => row.code);
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

    await pool.query(
      `INSERT INTO organizations (id, name, slug, status, license_plan, is_enabled, updated_at)
       VALUES ($1, 'Members', $2, 'ACTIVE', 'free', true, now())`,
      [ids.org, `mem-${suffix}`],
    );

    for (const [userId, email, membershipId] of [
      [ids.admin, adminEmail, ids.adminMembership],
      [ids.member, memberEmail, ids.memberMembership],
    ]) {
      await pool.query(
        `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
         VALUES ($1, $2, $2, 'Mem', 'Ber', 'ACTIVE', now())`,
        [userId, email],
      );
      await pool.query(
        `INSERT INTO user_credentials (id, user_id, password_hash, updated_at)
         VALUES ($1, $2, $3, now())`,
        [`usr_c${unique()}`, userId, hash],
      );
      await pool.query(
        `INSERT INTO organization_memberships (id, user_id, organization_id, status, joined_at, updated_at)
         VALUES ($1, $2, $3, 'ACTIVE', now(), now())`,
        [membershipId, userId, ids.org],
      );
    }

    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM roles WHERE code = 'CLIENT_ADMIN'`,
    );
    await pool.query(
      `INSERT INTO membership_role_assignments (id, membership_id, organization_id, role_id)
       VALUES ($1, $2, $3, $4)`,
      [`asg_${unique()}`, ids.adminMembership, ids.org, rows[0]!.id],
    );
    await app
      .get(PermissionsVersionStore, { strict: false })
      .bumpMembership(ids.adminMembership);
  });

  beforeEach(async () => {
    await resetRateLimits();
    // Chaque cas repart d'un membre sans rôle : les tests s'exécutent en série.
    await pool.query(
      `UPDATE membership_role_assignments
          SET revoked_at = now()
        WHERE membership_id = $1 AND revoked_at IS NULL`,
      [ids.memberMembership],
    );
    await app
      .get(PermissionsVersionStore, { strict: false })
      .bumpMembership(ids.memberMembership);
  });

  afterAll(async () => {
    const users = [ids.admin, ids.member];
    const purge = await pool.connect();
    try {
      await purge.query('BEGIN');
      await purge.query("SET LOCAL eventini.retention_purge = 'on'");
      await purge.query(
        `DELETE FROM refresh_token_rotations
          WHERE session_id IN (SELECT id FROM user_sessions WHERE user_id = ANY($1))`,
        [users],
      );
      await purge.query(`DELETE FROM audit_logs WHERE organization_id = $1`, [
        ids.org,
      ]);
      await purge.query('COMMIT');
    } finally {
      purge.release();
    }

    await pool.query(
      `DELETE FROM membership_role_assignments WHERE organization_id = $1`,
      [ids.org],
    );
    await pool.query(`DELETE FROM user_sessions WHERE user_id = ANY($1)`, [
      users,
    ]);
    await pool.query(
      `DELETE FROM organization_memberships WHERE user_id = ANY($1)`,
      [users],
    );
    await pool.query(`DELETE FROM user_credentials WHERE user_id = ANY($1)`, [
      users,
    ]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [users]);
    await pool.query(`DELETE FROM organizations WHERE id = $1`, [ids.org]);

    await pool.end();
    await app.close();
  });

  describe('liste des membres', () => {
    it('renvoie les membres avec leurs rôles actifs', async () => {
      const { jar } = await signIn(adminEmail);

      const response = await request(server())
        .get(membersUrl)
        .set('Cookie', jar)
        .expect(200);

      const members = (response.body as ApiEnvelope<MemberResponse[]>).data!;
      const admin = members.find((m) => m.membershipId === ids.adminMembership);

      expect(members).toHaveLength(2);
      expect(admin!.roleCodes).toEqual(['CLIENT_ADMIN']);
      expect(admin!.mfaEnabled).toBe(false);
    });

    /**
     * 🔴 Le ticket l'exige : « pas de hash, pas de secret MFA, pas d'adresse IP
     * de session ». Un `select *` les gagnerait silencieusement.
     */
    it("n'expose ni credential, ni secret MFA, ni adresse IP", async () => {
      const { jar } = await signIn(adminEmail);

      const response = await request(server())
        .get(membersUrl)
        .set('Cookie', jar)
        .expect(200);

      const raw = JSON.stringify(response.body);

      for (const forbidden of [
        'passwordHash',
        'password_hash',
        'secret',
        'ipAddress',
        'ip_address',
        'totp',
        'recoveryCode',
      ]) {
        expect(raw).not.toContain(forbidden);
      }
    });

    it("refuse la liste d'une autre organisation", async () => {
      const { jar } = await signIn(adminEmail);

      await request(server())
        .get(`/api/v1/organizations/org_inexistant/members`)
        .set('Cookie', jar)
        .expect(403);
    });
  });

  describe('assignation de rôles', () => {
    it('remplace l ensemble des rôles et rend l avant et l après', async () => {
      const session = await signIn(adminEmail);

      const response = await setRoles(session, ids.memberMembership, [
        'CLIENT_ADMIN',
      ]);

      expect(response.status).toBe(200);
      const body = (
        response.body as ApiEnvelope<{
          previousRoleCodes: string[];
          roleCodes: string[];
        }>
      ).data!;

      expect(body.previousRoleCodes).toEqual([]);
      expect(body.roleCodes).toEqual(['CLIENT_ADMIN']);
      expect(await activeRoleCodes(ids.memberMembership)).toEqual([
        'CLIENT_ADMIN',
      ]);
    });

    /** `revoked_at`, jamais `DELETE` : la ligne reste pour l'auditeur. */
    it('révoque au lieu de supprimer', async () => {
      const session = await signIn(adminEmail);

      await setRoles(session, ids.memberMembership, ['CLIENT_ADMIN']);
      await setRoles(session, ids.memberMembership, []);

      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM membership_role_assignments
          WHERE membership_id = $1 AND revoked_at IS NOT NULL`,
        [ids.memberMembership],
      );

      // La ligne demeure, marquée révoquée : qui a tenu quel rôle et jusqu'à
      // quand est exactement ce qu'un auditeur vient chercher.
      expect(Number(rows[0]!.count)).toBeGreaterThan(0);
      expect(await activeRoleCodes(ids.memberMembership)).toEqual([]);
    });

    it('accepte un ensemble vide, qui retire tous les rôles', async () => {
      const session = await signIn(adminEmail);

      await setRoles(session, ids.memberMembership, ['CLIENT_ADMIN']);
      const response = await setRoles(session, ids.memberMembership, []);

      expect(response.status).toBe(200);
      expect(await activeRoleCodes(ids.memberMembership)).toEqual([]);
    });

    /**
     * 🔴 L'escalade la plus directe que ce schéma autorise. Refusée par
     * l'application **et** par le trigger INV-09 — mais l'application refuse
     * d'abord, pour ne pas confirmer que le rôle existe.
     */
    it('refuse un rôle PLATFORM comme un rôle inexistant', async () => {
      const session = await signIn(adminEmail);

      const platform = await setRoles(session, ids.memberMembership, [
        'SUPER_ADMIN',
      ]);
      const unknown = await setRoles(session, ids.memberMembership, [
        'PAS_UN_ROLE',
      ]);

      expect(platform.status).toBe(400);
      expect(unknown.status).toBe(400);
      // Réponses indistinguables : le catalogue plateforme reste invisible.
      expect((platform.body as ApiEnvelope<null>).error!.detail).toBe(
        (unknown.body as ApiEnvelope<null>).error!.detail,
      );
      expect(await activeRoleCodes(ids.memberMembership)).toEqual([]);
    });

    /**
     * 🔴 S'accorder un rôle est une élévation de privilège en une requête, par
     * quelqu'un qui a déjà le droit d'en accorder aux autres.
     */
    it('refuse de modifier ses propres rôles', async () => {
      const session = await signIn(adminEmail);

      const response = await setRoles(session, ids.adminMembership, []);

      expect(response.status).toBe(403);
      expect(await activeRoleCodes(ids.adminMembership)).toEqual([
        'CLIENT_ADMIN',
      ]);
    });

    it("refuse un membership d'une autre organisation", async () => {
      const session = await signIn(adminEmail);

      const response = await setRoles(session, 'mbr_inexistant', [
        'CLIENT_ADMIN',
      ]);

      expect(response.status).toBe(404);
    });

    it('refuse un doublon plutôt que de heurter l index partiel', async () => {
      const session = await signIn(adminEmail);

      const response = await setRoles(session, ids.memberMembership, [
        'CLIENT_ADMIN',
        'CLIENT_ADMIN',
      ]);

      expect(response.status).toBe(400);
    });
  });

  describe('effets de bord obligatoires', () => {
    /**
     * 🔴 Le cœur du ticket : l'incrément de `permissionsVersion` dans la
     * transaction est ce qui rend la révocation immédiate. Ici, l'ajout d'un
     * rôle est visible **sur le même jeton d'accès**, sans attendre le TTL du
     * cache de permissions.
     */
    it('rend le changement visible sur le MÊME jeton d accès', async () => {
      const session = await signIn(adminEmail);
      const memberSession = await signIn(memberEmail);

      // Sans rôle, la lecture des membres est refusée.
      await request(server())
        .get(membersUrl)
        .set('Cookie', memberSession.jar)
        .expect(403);

      await setRoles(session, ids.memberMembership, ['CLIENT_ADMIN']);

      // Même cookie, sans reconnexion : la permission est désormais accordée.
      await request(server())
        .get(membersUrl)
        .set('Cookie', memberSession.jar)
        .expect(200);

      await setRoles(session, ids.memberMembership, []);

      // Et la révocation prend effet tout aussi immédiatement.
      await request(server())
        .get(membersUrl)
        .set('Cookie', memberSession.jar)
        .expect(403);
    });

    /** L'entrée d'audit est écrite dans la même transaction que le changement. */
    it('écrit une entrée d audit avec l avant et l après', async () => {
      const session = await signIn(adminEmail);

      await setRoles(session, ids.memberMembership, ['CLIENT_ADMIN']);

      const { rows } = await pool.query<{
        actor_user_id: string;
        actor_role: string | null;
        target_id: string;
        previous_values: { roleCodes: string[] };
        new_values: { roleCodes: string[] };
      }>(
        `SELECT actor_user_id, actor_role, target_id, previous_values, new_values
           FROM audit_logs
          WHERE action = 'membership.roles.replaced' AND target_id = $1
          ORDER BY occurred_at DESC LIMIT 1`,
        [ids.memberMembership],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]!.actor_user_id).toBe(ids.admin);
      // Le rôle de l'acteur au moment de l'action, en texte.
      expect(rows[0]!.actor_role).toBe('CLIENT_ADMIN');
      expect(rows[0]!.previous_values.roleCodes).toEqual([]);
      expect(rows[0]!.new_values.roleCodes).toEqual(['CLIENT_ADMIN']);
    });

    /** Un refus ne doit rien laisser derrière lui — ni rôle, ni audit. */
    it("n'écrit aucun audit quand le changement est refusé", async () => {
      const session = await signIn(adminEmail);

      const before = await pool.query<{ count: string }>(
        `SELECT count(*) FROM audit_logs WHERE target_id = $1`,
        [ids.memberMembership],
      );

      await setRoles(session, ids.memberMembership, ['SUPER_ADMIN']);

      const after = await pool.query<{ count: string }>(
        `SELECT count(*) FROM audit_logs WHERE target_id = $1`,
        [ids.memberMembership],
      );

      expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
    });
  });
});
