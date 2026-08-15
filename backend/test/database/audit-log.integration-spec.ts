import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { PrismaClient } from '../../src/infrastructure/database/prisma/generated/client';
import {
  withTenantScope,
  type TenantScopedPrismaClient,
} from '../../src/infrastructure/database/tenant-scope.extension';
import { AuditRecorder } from '../../src/modules/audit';
import { PrismaAuditLogRepository } from '../../src/modules/audit/infrastructure/prisma-audit-log.repository';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

/**
 * Le journal d'audit — EVT-076.
 *
 * Contre PostgreSQL réel, et pas seulement par habitude : deux garanties de ce
 * module sont tenues par la base et par rien d'autre — l'atomicité avec la
 * transaction appelante, et le caractère append-only imposé par
 * `trg_audit_logs_append_only`. Un double de repository les affirmerait toutes
 * les deux sans en prouver aucune.
 */
describeWithDatabase('Audit log (EVT-076)', () => {
  let recorder: AuditRecorder;
  let prisma: PrismaClient;
  let scoped: TenantScopedPrismaClient;
  let pool: Pool;

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);
  const suffix = unique();
  const ids = {
    org: `org_d${suffix}`,
    user: `usr_d${suffix}`,
  };

  const context = {
    organizationId: ids.org,
    membershipId: `mbr_d${suffix}`,
    userId: ids.user,
    sessionId: `ses_d${suffix}`,
    authLevel: 'PASSWORD' as const,
  };

  const facts = {
    requestId: 'req_01JABC',
    ipAddress: '203.0.113.10',
    actorRole: 'CLIENT_ADMIN',
  };

  async function rowsFor(action: string) {
    const { rows } = await pool.query<{
      id: string;
      actor_user_id: string | null;
      actor_role: string | null;
      organization_id: string | null;
      target_type: string;
      target_id: string | null;
      action: string;
      previous_values: unknown;
      new_values: unknown;
      request_id: string | null;
      ip_address: string | null;
    }>(`SELECT * FROM audit_logs WHERE action = $1`, [action]);

    return rows;
  }

  beforeAll(async () => {
    /*
      Construit à la main, sans conteneur Nest — comme tous les autres tests de
      cette suite.

      Le job `Migrations` de la CI exécute `test:integration` avec **seulement**
      `DATABASE_URL` : ni `.env`, ni secrets. Démarrer `AppModule` y échoue à la
      validation d'environnement, et c'est ainsi que ce test a cassé la CI au
      premier passage. Or rien de ce qu'il vérifie n'a besoin du conteneur : le
      sujet est ce que PostgreSQL fait d'une transaction et d'un trigger.
    */
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: DATABASE_URL }),
    });

    /*
      Enveloppé par la garde tenant, comme l'application le fait : c'est d'elle
      que dérive le type `TransactionalClient`, et tester contre un client nu
      exercerait un chemin que la production n'emprunte jamais.
    */
    scoped = withTenantScope(prisma);
    recorder = new AuditRecorder(new PrismaAuditLogRepository());

    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    pool.on('error', () => undefined);

    await pool.query(
      `INSERT INTO organizations (id, name, slug, status, license_plan, is_enabled, updated_at)
       VALUES ($1, 'Audit', $2, 'ACTIVE', 'free', true, now())`,
      [ids.org, `audit-${suffix}`],
    );
  });

  afterAll(async () => {
    const purge = await pool.connect();
    try {
      // La table est append-only : la purge de rétention est la seule
      // suppression autorisée, et le trigger la reconnaît à ce réglage.
      await purge.query('BEGIN');
      await purge.query("SET LOCAL eventini.retention_purge = 'on'");
      await purge.query(`DELETE FROM audit_logs WHERE organization_id = $1`, [
        ids.org,
      ]);
      await purge.query(`DELETE FROM audit_logs WHERE actor_user_id = $1`, [
        ids.user,
      ]);
      await purge.query('COMMIT');
    } finally {
      purge.release();
    }

    await pool.query(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
    await pool.end();
    await prisma.$disconnect();
  });

  it("remplit l'acteur, la cible et la requête depuis le contexte", async () => {
    const action = `test.recorded.${unique()}`;

    await scoped.$transaction((tx) =>
      recorder.record(
        tx,
        context,
        {
          action,
          targetType: 'organization',
          targetId: ids.org,
          previousValues: { name: 'Avant' },
          newValues: { name: 'Après' },
        },
        facts,
      ),
    );

    const [row] = await rowsFor(action);

    expect(row).toBeDefined();
    expect(row!.actor_user_id).toBe(ids.user);
    expect(row!.actor_role).toBe('CLIENT_ADMIN');
    expect(row!.organization_id).toBe(ids.org);
    expect(row!.target_type).toBe('organization');
    expect(row!.target_id).toBe(ids.org);
    expect(row!.request_id).toBe('req_01JABC');
    expect(row!.ip_address).toBe('203.0.113.10');
    expect(row!.previous_values).toEqual({ name: 'Avant' });
    expect(row!.new_values).toEqual({ name: 'Après' });
  });

  /**
   * 🔴 La raison d'être du port : l'entrée d'audit vit ou meurt avec le
   * changement qu'elle décrit. Hors transaction, un échec entre les deux
   * laisse un changement sans trace — le pire des deux états, puisque plus
   * rien ne dit qu'il a eu lieu.
   */
  it("disparaît quand la transaction de l'appelant échoue", async () => {
    const action = `test.rolled-back.${unique()}`;

    await expect(
      scoped.$transaction(async (tx) => {
        await recorder.record(
          tx,
          context,
          { action, targetType: 'organization', targetId: ids.org },
          facts,
        );

        throw new Error('le changement métier a échoué');
      }),
    ).rejects.toThrow('le changement métier a échoué');

    expect(await rowsFor(action)).toHaveLength(0);
  });

  /**
   * §8.2 : les champs sensibles sont **remplacés**, jamais omis. Une clé
   * absente dirait que la valeur n'a pas changé — l'inverse exact de la
   * vérité, et ce que quelqu'un couvrant ses traces voudrait qu'elle dise.
   */
  it('remplace les valeurs sensibles sans supprimer leur clé', async () => {
    const action = `test.redacted.${unique()}`;

    await scoped.$transaction((tx) =>
      recorder.record(
        tx,
        context,
        {
          action,
          targetType: 'user',
          targetId: ids.user,
          previousValues: { email: 'a@b.fr', password: 'ancien-secret' },
          newValues: { email: 'a@b.fr', password: 'nouveau-secret' },
        },
        facts,
      ),
    );

    const [row] = await rowsFor(action);
    const previous = row!.previous_values as Record<string, unknown>;
    const next = row!.new_values as Record<string, unknown>;

    expect(previous).toHaveProperty('password');
    expect(previous.password).toBe('[REDACTED]');
    expect(next.password).toBe('[REDACTED]');
    // Le fait du changement reste lisible, sa valeur non.
    expect(JSON.stringify(row)).not.toContain('ancien-secret');
    expect(JSON.stringify(row)).not.toContain('nouveau-secret');
    // Ce qui n'est pas sensible traverse intact.
    expect(previous.email).toBe('a@b.fr');
  });

  it('accepte une action de portée plateforme, sans organisation', async () => {
    const action = `test.platform.${unique()}`;

    await scoped.$transaction((tx) =>
      recorder.recordPlatformAction(
        tx,
        { userId: ids.user, sessionId: null },
        { action, targetType: 'organization', targetId: ids.org },
        { ...facts, actorRole: 'SUPER_ADMIN' },
      ),
    );

    const [row] = await rowsFor(action);

    expect(row!.organization_id).toBeNull();
    expect(row!.actor_role).toBe('SUPER_ADMIN');
  });

  it('accepte une action système sans acteur', async () => {
    const action = `test.system.${unique()}`;

    await scoped.$transaction((tx) =>
      recorder.recordPlatformAction(
        tx,
        { userId: null, sessionId: null },
        { action, targetType: 'retention', targetId: null },
        { requestId: null, ipAddress: null, actorRole: null },
      ),
    );

    const [row] = await rowsFor(action);

    expect(row!.actor_user_id).toBeNull();
    expect(row!.target_id).toBeNull();
  });

  /**
   * `Prisma.DbNull` et non `null` : sur une colonne JSON nullable, un `null`
   * JavaScript écrit le **littéral JSON `null`**, que la relecture ne
   * distinguerait pas d'une valeur réellement nulle.
   */
  it('écrit SQL NULL, et non le littéral JSON null, quand il n y a pas de diff', async () => {
    const action = `test.nodiff.${unique()}`;

    await scoped.$transaction((tx) =>
      recorder.record(
        tx,
        context,
        { action, targetType: 'organization', targetId: ids.org },
        facts,
      ),
    );

    const { rows } = await pool.query<{ is_sql_null: boolean }>(
      `SELECT previous_values IS NULL AS is_sql_null
         FROM audit_logs WHERE action = $1`,
      [action],
    );

    expect(rows[0]!.is_sql_null).toBe(true);
  });

  describe('append-only', () => {
    /**
     * 🔴 `trg_audit_logs_append_only`. Une piste d'audit modifiable après coup
     * n'est pas une piste d'audit : celui qui veut effacer sa trace est
     * précisément celui qui a les droits d'écrire.
     */
    it('refuse une mise à jour', async () => {
      const action = `test.immutable.${unique()}`;

      await scoped.$transaction((tx) =>
        recorder.record(
          tx,
          context,
          { action, targetType: 'organization', targetId: ids.org },
          facts,
        ),
      );

      await expect(
        pool.query(
          `UPDATE audit_logs SET action = 'falsifié' WHERE action = $1`,
          [action],
        ),
      ).rejects.toThrow();
    });

    it('refuse une suppression hors purge de rétention', async () => {
      const action = `test.undeletable.${unique()}`;

      await scoped.$transaction((tx) =>
        recorder.record(
          tx,
          context,
          { action, targetType: 'organization', targetId: ids.org },
          facts,
        ),
      );

      await expect(
        pool.query(`DELETE FROM audit_logs WHERE action = $1`, [action]),
      ).rejects.toThrow();
    });
  });
});
