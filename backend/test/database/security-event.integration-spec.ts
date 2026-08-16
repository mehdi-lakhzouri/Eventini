import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import type { PinoLogger } from 'nestjs-pino';
import { Pool } from 'pg';

import { SECURITY_EVENT_TYPES } from '../../src/infrastructure/database/enums';
import { PrismaClient } from '../../src/infrastructure/database/prisma/generated/client';
import {
  withTenantScope,
  type TenantScopedPrismaClient,
} from '../../src/infrastructure/database/tenant-scope.extension';
import { SecurityEventRecorder } from '../../src/modules/identity/security-events';
import { PrismaSecurityEventRepository } from '../../src/modules/identity/security-events/infrastructure/prisma-security-event.repository';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

/**
 * Le journal des événements de sécurité — EVT-077.
 *
 * Contre PostgreSQL réel, parce que quatre garanties de ce module sont tenues
 * par la base et par rien d'autre : les trois contraintes `CHECK` sur le type,
 * la gravité et l'issue ; le trigger append-only ; le refus d'une valeur `INET`
 * malformée ; et surtout l'**indépendance** vis-à-vis de la transaction de
 * l'appelant, qui est la décision centrale du ticket. Un double de repository
 * les affirmerait toutes sans en prouver aucune.
 */
describeWithDatabase('Security events (EVT-077)', () => {
  let recorder: SecurityEventRecorder;
  let prisma: PrismaClient;
  let scoped: TenantScopedPrismaClient;
  let pool: Pool;
  const logged: Record<string, unknown>[] = [];

  const unique = (): string => randomUUID().replaceAll('-', '').slice(0, 12);
  const suffix = unique();
  const ids = {
    org: `org_s${suffix}`,
    user: `usr_s${suffix}`,
  };

  interface Row {
    id: string;
    event_type: string;
    severity: string;
    result: string;
    reason_code: string | null;
    user_id: string | null;
    session_id: string | null;
    organization_id: string | null;
    membership_id: string | null;
    request_id: string | null;
    ip_address: string | null;
    user_agent: string | null;
    metadata: Record<string, unknown>;
  }

  async function rowsFor(reasonCode: string): Promise<Row[]> {
    const { rows } = await pool.query<Row>(
      `SELECT * FROM security_events WHERE reason_code = $1`,
      [reasonCode],
    );

    return rows;
  }

  beforeAll(async () => {
    /*
      Construit à la main, sans conteneur Nest — comme tous les autres tests de
      cette suite. Le job `Migrations` de la CI exécute `test:integration` avec
      **seulement** `DATABASE_URL` : ni `.env`, ni secrets, donc démarrer
      `AppModule` y échouerait à la validation d'environnement.
    */
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: DATABASE_URL }),
    });

    scoped = withTenantScope(prisma);

    const logger = {
      error: (payload: Record<string, unknown>) => {
        logged.push(payload);
      },
    } as unknown as PinoLogger;

    recorder = new SecurityEventRecorder(
      new PrismaSecurityEventRepository(scoped),
      logger,
    );

    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    pool.on('error', () => undefined);

    await pool.query(
      `INSERT INTO organizations (id, name, slug, status, license_plan, is_enabled, updated_at)
       VALUES ($1, 'Security', $2, 'ACTIVE', 'free', true, now())`,
      [ids.org, `security-${suffix}`],
    );
  });

  afterAll(async () => {
    const purge = await pool.connect();
    try {
      // Append-only : la purge de rétention est la seule suppression permise,
      // et le trigger la reconnaît à ce réglage.
      await purge.query('BEGIN');
      await purge.query("SET LOCAL eventini.retention_purge = 'on'");
      await purge.query(
        `DELETE FROM security_events WHERE reason_code LIKE $1`,
        [`t_${suffix}%`],
      );
      await purge.query('COMMIT');
    } finally {
      purge.release();
    }

    await pool.query(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
    await pool.end();
    await prisma.$disconnect();
  });

  /**
   * 🔴 Les 33 types du catalogue, écrits pour de vrai.
   *
   * `ck_security_events_type`, `ck_security_events_severity` et
   * `ck_security_events_result` sont trois listes en dur dans le SQL. Un type
   * ajouté à `enums.ts` sans être ajouté à la contrainte passerait la
   * compilation, passerait les tests unitaires, et échouerait **en silence** en
   * production — puisque le recorder ne relance jamais. Le seul moyen de le
   * savoir est de les écrire toutes.
   */
  it('accepte chacun des 33 types du catalogue, avec son profil', async () => {
    const reasonCode = `t_${suffix}_catalogue`;

    for (const type of SECURITY_EVENT_TYPES) {
      await recorder.record(type, { reasonCode });
    }

    const rows = await rowsFor(reasonCode);

    expect(rows).toHaveLength(SECURITY_EVENT_TYPES.length);
    expect(new Set(rows.map((row) => row.event_type))).toEqual(
      new Set(SECURITY_EVENT_TYPES),
    );
    // Aucun échec avalé en chemin : la table est remplie *et* le log est muet.
    expect(logged).toEqual([]);
  });

  /**
   * 🔴 La décision centrale du ticket, prouvée par la base.
   *
   * L'audit doit tomber avec le changement qu'il décrit. L'événement de
   * sécurité doit lui **survivre** : `LOGIN_FAILED`,
   * `ROLE_ESCALATION_ATTEMPTED` et `TENANT_ACCESS_DENIED` sont émis quand rien
   * n'est commité. S'ils partageaient la transaction de l'appelant, la table
   * serait vide exactement des lignes pour lesquelles elle existe.
   */
  it("survit au rollback de la transaction de l'appelant", async () => {
    const reasonCode = `t_${suffix}_rollback`;

    await expect(
      scoped.$transaction(async () => {
        await recorder.record('ROLE_ESCALATION_ATTEMPTED', {
          reasonCode,
          userId: ids.user,
          organizationId: ids.org,
        });

        throw new Error('le changement métier a échoué');
      }),
    ).rejects.toThrow('le changement métier a échoué');

    const rows = await rowsFor(reasonCode);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_type).toBe('ROLE_ESCALATION_ATTEMPTED');
    expect(rows[0]!.result).toBe('DENIED');
  });

  it('écrit toutes les colonnes de contexte', async () => {
    const reasonCode = `t_${suffix}_full`;

    await recorder.record('LOGIN_SUCCEEDED', {
      reasonCode,
      userId: ids.user,
      organizationId: ids.org,
      requestId: 'req_01JABC',
      ipAddress: '203.0.113.10',
      userAgent: 'jest',
      metadata: { clientType: 'WEB' },
    });

    const [row] = await rowsFor(reasonCode);

    expect(row!.severity).toBe('INFO');
    expect(row!.result).toBe('SUCCESS');
    expect(row!.user_id).toBe(ids.user);
    expect(row!.organization_id).toBe(ids.org);
    expect(row!.request_id).toBe('req_01JABC');
    expect(row!.ip_address).toBe('203.0.113.10');
    expect(row!.user_agent).toBe('jest');
    expect(row!.metadata).toEqual({ clientType: 'WEB' });
  });

  /**
   * Un événement peut précéder l'identité entièrement — un rejet d'origine n'a
   * ni utilisateur, ni session, ni organisation. Ce sont les index partiels qui
   * rendent ce choix tenable.
   */
  it('accepte un événement sans aucun acteur', async () => {
    const reasonCode = `t_${suffix}_anonymous`;

    await recorder.record('ORIGIN_VALIDATION_FAILED', {
      reasonCode,
      ipAddress: '198.51.100.4',
    });

    const [row] = await rowsFor(reasonCode);

    expect(row!.user_id).toBeNull();
    expect(row!.session_id).toBeNull();
    expect(row!.organization_id).toBeNull();
    expect(row!.severity).toBe('MEDIUM');
  });

  describe('adresse IP', () => {
    /**
     * 🔴 La primitive de suppression que ça ferme.
     *
     * `ip_address` est de type `INET` et sa valeur vient d'`request.ip`, donc
     * potentiellement d'un `X-Forwarded-For`. PostgreSQL refuse une valeur
     * malformée, et comme le recorder ne relance jamais, l'insertion échouerait
     * **en silence** : envoyer un en-tête invalide suffirait à ne laisser
     * aucune trace de ses tentatives. On perd l'adresse, jamais l'événement.
     */
    it("garde l'événement quand l'adresse est malformée", async () => {
      const reasonCode = `t_${suffix}_badip`;

      await recorder.record('LOGIN_FAILED', {
        reasonCode,
        ipAddress: 'not-an-ip; DROP TABLE',
      });

      const [row] = await rowsFor(reasonCode);

      expect(row).toBeDefined();
      expect(row!.ip_address).toBeNull();
      expect(row!.event_type).toBe('LOGIN_FAILED');
    });

    it('accepte une adresse IPv6', async () => {
      const reasonCode = `t_${suffix}_ipv6`;

      await recorder.record('LOGIN_FAILED', {
        reasonCode,
        ipAddress: '2001:db8::8a2e:370:7334',
      });

      const [row] = await rowsFor(reasonCode);

      expect(row!.ip_address).toBe('2001:db8::8a2e:370:7334');
    });
  });

  /** §8 : mot de passe, jetons et secrets ne sont **jamais** journalisés. */
  it('remplace un secret dans metadata sans perdre la clé', async () => {
    const reasonCode = `t_${suffix}_redacted`;

    await recorder.record('LOGIN_FAILED', {
      reasonCode,
      metadata: {
        attemptedEmail: 'a@b.test',
        password: 'ancien-secret',
        refreshToken: 'rt_live_value',
      },
    });

    const [row] = await rowsFor(reasonCode);

    expect(row!.metadata).toEqual({
      attemptedEmail: 'a@b.test',
      password: '[REDACTED]',
      refreshToken: '[REDACTED]',
    });
    expect(JSON.stringify(row)).not.toContain('ancien-secret');
    expect(JSON.stringify(row)).not.toContain('rt_live_value');
  });

  describe('append-only', () => {
    /**
     * 🔴 `trg_security_events_append_only`. Un journal de sécurité réécrivable
     * après coup ne prouve rien : celui qui veut effacer sa trace est
     * précisément celui qui a les droits.
     */
    it('refuse une mise à jour', async () => {
      const reasonCode = `t_${suffix}_immutable`;

      await recorder.record('ACCOUNT_LOCKED', { reasonCode });

      await expect(
        pool.query(
          `UPDATE security_events SET severity = 'INFO' WHERE reason_code = $1`,
          [reasonCode],
        ),
      ).rejects.toThrow();
    });

    it('refuse une suppression hors purge de rétention', async () => {
      const reasonCode = `t_${suffix}_undeletable`;

      await recorder.record('ACCOUNT_LOCKED', { reasonCode });

      await expect(
        pool.query(`DELETE FROM security_events WHERE reason_code = $1`, [
          reasonCode,
        ]),
      ).rejects.toThrow();
    });
  });
});
