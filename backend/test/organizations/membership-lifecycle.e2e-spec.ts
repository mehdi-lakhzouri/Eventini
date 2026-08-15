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

interface LifecycleResponse {
  membershipId: string;
  previousStatus: string;
  status: string;
  revokedSessions: number;
  revokedEventAssignments: number;
}

/**
 * Cycle de vie des memberships — EVT-045.
 *
 * Le scénario métier que ce ticket ferme : **un administrateur quitte
 * l'organisation cliente et conserve ses cookies**. Il ne se prouve que contre
 * une vraie base et un vrai Redis — le refus dépend de l'étape 5 de la chaîne
 * lisant `membershipStatus`, et la coupure des sessions d'un `UPDATE` réel.
 */
describeWithDatabase('Membership lifecycle (EVT-045)', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let names: { access: string; refresh: string };

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);
  const suffix = unique();
  const ids = {
    org: `org_l${suffix}`,
    admin: `usr_l${suffix}`,
    adminMembership: `mbr_l${suffix}`,
    member: `usr_k${suffix}`,
    memberMembership: `mbr_k${suffix}`,
  };
  const adminEmail = `boss.${suffix}@eventini.test`;
  const memberEmail = `staff.${suffix}@eventini.test`;

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

  const suspend = (session: { jar: string; csrf: Csrf }, id: string) =>
    request(server())
      .post(`${membersUrl}/${id}/suspension`)
      .set(session.csrf.headers(session.jar))
      .send({ reason: 'Congé sabbatique' });

  const reactivate = (session: { jar: string; csrf: Csrf }, id: string) =>
    request(server())
      .delete(`${membersUrl}/${id}/suspension`)
      .set(session.csrf.headers(session.jar))
      .send();

  const revoke = (session: { jar: string; csrf: Csrf }, id: string) =>
    request(server())
      .delete(`${membersUrl}/${id}`)
      .set(session.csrf.headers(session.jar))
      .send({ reason: 'Départ de la société' });

  async function statusOf(membershipId: string): Promise<string> {
    const { rows } = await pool.query<{ status: string }>(
      `SELECT status FROM organization_memberships WHERE id = $1`,
      [membershipId],
    );

    return rows[0]!.status;
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
       VALUES ($1, 'Lifecycle', $2, 'ACTIVE', 'free', true, now())`,
      [ids.org, `life-${suffix}`],
    );

    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM roles WHERE code = 'CLIENT_ADMIN'`,
    );

    for (const [userId, email, membershipId] of [
      [ids.admin, adminEmail, ids.adminMembership],
      [ids.member, memberEmail, ids.memberMembership],
    ]) {
      await pool.query(
        `INSERT INTO users (id, primary_email, normalized_email, first_name, last_name, status, updated_at)
         VALUES ($1, $2, $2, 'Life', 'Cycle', 'ACTIVE', now())`,
        [userId!, email!],
      );
      await pool.query(
        `INSERT INTO user_credentials (id, user_id, password_hash, updated_at)
         VALUES ($1, $2, $3, now())`,
        [`usr_c${unique()}`, userId!, hash],
      );
      await pool.query(
        `INSERT INTO organization_memberships (id, user_id, organization_id, status, joined_at, updated_at)
         VALUES ($1, $2, $3, 'ACTIVE', now(), now())`,
        [membershipId!, userId!, ids.org],
      );
      // Les deux sont administrateurs : le membre doit pouvoir lire la liste
      // pour que le test de révocation observe un passage de 200 à 403.
      await pool.query(
        `INSERT INTO membership_role_assignments (id, membership_id, organization_id, role_id)
         VALUES ($1, $2, $3, $4)`,
        [`asg_${unique()}`, membershipId!, ids.org, rows[0]!.id],
      );
      await app
        .get(PermissionsVersionStore, { strict: false })
        .bumpMembership(membershipId!);
    }
  });

  beforeEach(async () => {
    await resetRateLimits();
    // Chaque cas repart d'un membre ACTIVE, ses sessions coupées.
    await pool.query(
      `UPDATE organization_memberships
          SET status = 'ACTIVE', suspended_at = NULL, revoked_at = NULL
        WHERE id = $1`,
      [ids.memberMembership],
    );
    await pool.query(
      `UPDATE user_sessions SET status = 'REVOKED' WHERE user_id = $1 AND status = 'ACTIVE'`,
      [ids.member],
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

  describe('suspension', () => {
    it('passe ACTIVE à SUSPENDED et enregistre la raison', async () => {
      const session = await signIn(adminEmail);

      const response = await suspend(session, ids.memberMembership);

      expect(response.status).toBe(201);
      const body = (response.body as ApiEnvelope<LifecycleResponse>).data!;
      expect(body.previousStatus).toBe('ACTIVE');
      expect(body.status).toBe('SUSPENDED');
      expect(await statusOf(ids.memberMembership)).toBe('SUSPENDED');

      const { rows } = await pool.query<{ reason: string | null }>(
        `SELECT reason FROM audit_logs
          WHERE action = 'membership.suspended' AND target_id = $1
          ORDER BY occurred_at DESC LIMIT 1`,
        [ids.memberMembership],
      );
      expect(rows[0]!.reason).toBe('Congé sabbatique');
    });

    /**
     * 🔴 Le refus est immédiat sans couper la session : l'étape 5 lit
     * `membershipStatus` à chaque requête depuis EVT-036.
     */
    it('refuse le membre suspendu sur son jeton existant', async () => {
      const admin = await signIn(adminEmail);
      const member = await signIn(memberEmail);

      await request(server())
        .get(membersUrl)
        .set('Cookie', member.jar)
        .expect(200);

      await suspend(admin, ids.memberMembership);

      await request(server())
        .get(membersUrl)
        .set('Cookie', member.jar)
        .expect(403);
    });

    /**
     * La suspension ne coupe **pas** les sessions : la réactivation serait
     * inutilement brutale, l'intéressé devant se reconnecter alors que rien
     * ne l'exige.
     */
    it('laisse la session vivante, et la réactivation la rend utilisable', async () => {
      const admin = await signIn(adminEmail);
      const member = await signIn(memberEmail);

      await suspend(admin, ids.memberMembership);

      const { rows } = await pool.query<{ status: string }>(
        `SELECT status FROM user_sessions WHERE user_id = $1 AND status = 'ACTIVE'`,
        [ids.member],
      );
      expect(rows.length).toBeGreaterThan(0);

      await reactivate(admin, ids.memberMembership);

      // Même cookie, sans reconnexion.
      await request(server())
        .get(membersUrl)
        .set('Cookie', member.jar)
        .expect(200);
    });

    it('refuse de suspendre deux fois', async () => {
      const admin = await signIn(adminEmail);

      await suspend(admin, ids.memberMembership);
      const second = await suspend(admin, ids.memberMembership);

      expect(second.status).toBe(409);
    });

    it('refuse de réactiver un membership actif', async () => {
      const admin = await signIn(adminEmail);

      expect((await reactivate(admin, ids.memberMembership)).status).toBe(409);
    });

    it('refuse de se suspendre soi-même', async () => {
      const admin = await signIn(adminEmail);

      const response = await suspend(admin, ids.adminMembership);

      expect(response.status).toBe(403);
      expect(await statusOf(ids.adminMembership)).toBe('ACTIVE');
    });
  });

  describe('révocation', () => {
    /**
     * 🔴 Le scénario du ticket : un administrateur quitte l'organisation et
     * conserve ses cookies.
     */
    it('coupe les sessions et refuse le jeton existant', async () => {
      const admin = await signIn(adminEmail);
      const member = await signIn(memberEmail);

      await request(server())
        .get(membersUrl)
        .set('Cookie', member.jar)
        .expect(200);

      const response = await revoke(admin, ids.memberMembership);

      expect(response.status).toBe(200);
      const body = (response.body as ApiEnvelope<LifecycleResponse>).data!;
      expect(body.status).toBe('REVOKED');
      // La session du membre a bien été comptée et coupée.
      expect(body.revokedSessions).toBeGreaterThan(0);

      /*
        🔴 `401`, et non le `403` que le ticket annonçait.

        Le ticket suppose que la session survit et que l'étape 5 la refuse.
        Mais EVT-045 coupe aussi les sessions : l'étape 2 — la validité de la
        session elle-même — échoue donc **avant** que l'étape 5 ne soit
        atteinte. Le résultat est plus fort que prévu : la session n'est pas
        refusée, elle n'existe plus.
      */
      await request(server())
        .get(membersUrl)
        .set('Cookie', member.jar)
        .expect(401);
    });

    /**
     * Couper la session en base fait plus que refuser : le refresh token cesse
     * de pouvoir en produire de nouvelles.
     */
    it('empêche le refresh token de produire une nouvelle session', async () => {
      const admin = await signIn(adminEmail);
      const member = await signIn(memberEmail);

      await revoke(admin, ids.memberMembership);

      const rotation = await request(server())
        .post('/api/v1/auth/sessions/current/rotation')
        .set(member.csrf.headers(member.jar))
        .send();

      expect(rotation.status).toBeGreaterThanOrEqual(400);
    });

    it('marque REVOKED sans supprimer la ligne', async () => {
      const admin = await signIn(adminEmail);

      await revoke(admin, ids.memberMembership);

      const { rows } = await pool.query<{
        status: string;
        revoked_at: Date | null;
        revoked_by: string | null;
        revocation_reason: string | null;
      }>(
        `SELECT status, revoked_at, revoked_by, revocation_reason
           FROM organization_memberships WHERE id = $1`,
        [ids.memberMembership],
      );

      // La trace de qui a appartenu à l'organisation, et jusqu'à quand.
      expect(rows[0]!.status).toBe('REVOKED');
      expect(rows[0]!.revoked_at).not.toBeNull();
      expect(rows[0]!.revoked_by).toBe(ids.admin);
      expect(rows[0]!.revocation_reason).toBe('Départ de la société');
    });

    it('révoque aussi les rôles par le compteur de version', async () => {
      const admin = await signIn(adminEmail);

      await revoke(admin, ids.memberMembership);

      const audit = await pool.query<{
        previous_values: { status: string };
        new_values: { status: string; revokedSessions: number };
      }>(
        `SELECT previous_values, new_values FROM audit_logs
          WHERE action = 'membership.revoked' AND target_id = $1
          ORDER BY occurred_at DESC LIMIT 1`,
        [ids.memberMembership],
      );

      expect(audit.rows[0]!.previous_values.status).toBe('ACTIVE');
      expect(audit.rows[0]!.new_values.status).toBe('REVOKED');
    });

    it('révoque un membership suspendu', async () => {
      const admin = await signIn(adminEmail);

      await suspend(admin, ids.memberMembership);
      const response = await revoke(admin, ids.memberMembership);

      expect(response.status).toBe(200);
      expect(await statusOf(ids.memberMembership)).toBe('REVOKED');
    });

    /**
     * Un départ est définitif : le retour passe par une nouvelle invitation,
     * ce qui laisse une trace de la décision au lieu de faire réapparaître un
     * accès silencieusement.
     */
    it('refuse de réactiver un membership révoqué', async () => {
      const admin = await signIn(adminEmail);

      await revoke(admin, ids.memberMembership);

      expect((await reactivate(admin, ids.memberMembership)).status).toBe(409);
      expect((await revoke(admin, ids.memberMembership)).status).toBe(409);
    });

    it('refuse de se révoquer soi-même', async () => {
      const admin = await signIn(adminEmail);

      const response = await revoke(admin, ids.adminMembership);

      expect(response.status).toBe(403);
      expect(await statusOf(ids.adminMembership)).toBe('ACTIVE');
    });

    it("refuse un membership d'une autre organisation", async () => {
      const admin = await signIn(adminEmail);

      expect((await revoke(admin, 'mbr_inexistant')).status).toBe(404);
    });
  });
});
