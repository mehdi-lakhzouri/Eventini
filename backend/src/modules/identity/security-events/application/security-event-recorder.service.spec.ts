import type { PinoLogger } from 'nestjs-pino';

import type { TenantContext } from '../../../../common/types/tenant-context';
import { SECURITY_EVENT_TYPES } from '../../../../infrastructure/database/enums';
import { SECURITY_EVENT_PROFILES } from '../domain/security-event-profile';
import type { SecurityEventRecord } from '../domain/security-event.repository';
import { SecurityEventRecorder } from './security-event-recorder.service';

function build(options: { failing?: boolean } = {}) {
  const written: SecurityEventRecord[] = [];
  const logged: Record<string, unknown>[] = [];

  const repository = {
    record: (event: SecurityEventRecord) => {
      if (options.failing === true) {
        return Promise.reject(new Error('connection terminated'));
      }

      written.push(event);

      return Promise.resolve();
    },
  };

  const logger = {
    error: (payload: Record<string, unknown>) => {
      logged.push(payload);
    },
  } as unknown as PinoLogger;

  return {
    recorder: new SecurityEventRecorder(repository, logger),
    written,
    logged,
  };
}

const CONTEXT: TenantContext = {
  userId: 'usr_1',
  sessionId: 'ses_1',
  organizationId: 'org_1',
  membershipId: 'mbr_1',
} as TenantContext;

describe('security event recorder', () => {
  describe('classification', () => {
    /**
     * Le catalogue et la table de profils doivent rester alignés : un type
     * ajouté à `enums.ts` sans profil sortirait `undefined` en gravité, et
     * PostgreSQL refuserait la ligne — donc l'événement serait perdu, en
     * silence, puisque le recorder ne relance jamais.
     */
    it('classifies every type the database will accept', () => {
      const missing = SECURITY_EVENT_TYPES.filter(
        (type) => SECURITY_EVENT_PROFILES[type] === undefined,
      );

      expect(missing).toEqual([]);
    });

    it('derives severity and result from the type, not from the caller', async () => {
      const { recorder, written } = build();

      await recorder.record('REFRESH_TOKEN_REUSE_DETECTED');

      expect(written[0]).toMatchObject({
        severity: 'CRITICAL',
        result: 'DENIED',
      });
    });
  });

  describe('never breaks the request it is describing', () => {
    /**
     * 🔴 Le scénario : la base est en difficulté, l'écriture échoue, et un
     * login par ailleurs valide deviendrait un 500. Pire, un refus légitime
     * deviendrait un 500 qui ressemble à un bug alors que la défense a
     * fonctionné.
     */
    it('swallows a write failure instead of failing the caller', async () => {
      const { recorder } = build({ failing: true });

      await expect(recorder.record('LOGIN_SUCCEEDED')).resolves.toBeUndefined();
    });

    /** Avaler en silence serait un angle mort : l'échec doit être bruyant. */
    it('logs the failure under an alertable code', async () => {
      const { recorder, logged } = build({ failing: true });

      await recorder.record('LOGIN_SUCCEEDED');

      expect(logged[0]).toMatchObject({
        category: 'SECURITY',
        eventCode: 'SECURITY_EVENT_WRITE_FAILED',
        securityEventType: 'LOGIN_SUCCEEDED',
      });
    });
  });

  describe('metadata', () => {
    /**
     * §8 : mot de passe, jetons, secret MFA, codes de récupération et token
     * d'invitation ne sont **jamais** journalisés.
     */
    it('redacts a secret a call site tried to record', async () => {
      const { recorder, written } = build();

      await recorder.record('LOGIN_FAILED', {
        metadata: { password: 'hunter2', attemptedEmail: 'a@b.test' },
      });

      expect(written[0]?.metadata).toEqual({
        password: '[REDACTED]',
        attemptedEmail: 'a@b.test',
      });
    });

    /**
     * Remplacer plutôt qu'omettre : une clé retirée en silence masquerait le
     * fait qu'un site d'émission a tenté d'enregistrer un secret, ce qui est un
     * bug qu'on veut voir.
     */
    it('keeps the key so the attempt stays visible', async () => {
      const { recorder, written } = build();

      await recorder.record('LOGIN_FAILED', {
        metadata: { refreshToken: 'rt_live' },
      });

      expect(Object.keys(written[0]?.metadata ?? {})).toEqual(['refreshToken']);
    });

    it('defaults to an empty object rather than null', async () => {
      const { recorder, written } = build();

      await recorder.record('LOGIN_SUCCEEDED');

      expect(written[0]?.metadata).toEqual({});
    });
  });

  describe('actor', () => {
    it('leaves every actor column null when identity is not known yet', async () => {
      const { recorder, written } = build();

      await recorder.record('ORIGIN_VALIDATION_FAILED', {
        ipAddress: '203.0.113.7',
      });

      expect(written[0]).toMatchObject({
        userId: null,
        sessionId: null,
        organizationId: null,
        membershipId: null,
        deviceId: null,
      });
    });

    it('fills the actor from the tenant context', async () => {
      const { recorder, written } = build();

      await recorder.recordForContext('ROLE_CHANGED', CONTEXT);

      expect(written[0]).toMatchObject({
        userId: 'usr_1',
        sessionId: 'ses_1',
        organizationId: 'org_1',
        membershipId: 'mbr_1',
      });
    });

    /**
     * Le cas qui compte : sur un changement de rôle, le membership visé n'est
     * pas celui de l'acteur. Écraser l'un par l'autre ferait pointer
     * l'événement sur la mauvaise personne.
     */
    it('lets an explicit membership win over the context', async () => {
      const { recorder, written } = build();

      await recorder.recordForContext('ROLE_CHANGED', CONTEXT, {
        membershipId: 'mbr_target',
      });

      expect(written[0]).toMatchObject({
        userId: 'usr_1',
        membershipId: 'mbr_target',
      });
    });
  });
});
