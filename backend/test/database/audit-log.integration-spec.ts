import { randomUUID } from 'node:crypto';

import { Test } from '@nestjs/testing';
import { Pool } from 'pg';

import { AppModule } from '../../src/app.module';
import { TransactionManager } from '../../src/infrastructure/database/transaction.manager';
import { AuditModule, AuditRecorder } from '../../src/modules/audit';

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
  let transactions: TransactionManager;
  let pool: Pool;
  let close: () => Promise<void>;

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
    const moduleRef = await Test.createTestingModule({
      /*
        `AppModule` plutôt qu'un assemblage minimal, et c'est délibéré.

        Monter `ConfigModule.forRoot` à la main retombe dans le piège que
        documente `app.module.ts` : la validation réécrit les durées en
        millisecondes dans `process.env`, et la seconde passe des factories
        refuse `"600000"` là où elle attend `"10m"`. L'application l'évite en
        préchargeant `.env` **avant** `forRoot`. Reproduire cette précaution
        ici en ferait une seconde copie à maintenir, pour un test dont le sujet
        n'est pas l'amorçage.
      */
      imports: [
        AppModule,
        /*
          Importé explicitement : `AppModule` ne le monte pas encore, faute de
          consommateur avant EVT-044. C'est délibéré — un module sans appelant
          dans l'arbre de l'application est un module dont on ne sait pas s'il
          est réellement câblé.
        */
        AuditModule,
      ],
    }).compile();

    const app = await moduleRef.createNestApplication().init();
    close = () => app.close();

    recorder = app.get(AuditRecorder, { strict: false });
    transactions = app.get(TransactionManager, { strict: false });

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
    await close();
  });

  it("remplit l'acteur, la cible et la requête depuis le contexte", async () => {
    const action = `test.recorded.${unique()}`;

    await transactions.runInTransaction((tx) =>
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
      transactions.runInTransaction(async (tx) => {
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

    await transactions.runInTransaction((tx) =>
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

    await transactions.runInTransaction((tx) =>
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

    await transactions.runInTransaction((tx) =>
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

    await transactions.runInTransaction((tx) =>
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

      await transactions.runInTransaction((tx) =>
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

      await transactions.runInTransaction((tx) =>
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
