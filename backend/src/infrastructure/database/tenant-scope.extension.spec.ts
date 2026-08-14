import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './prisma/generated/client';
import { TenantScopeViolationError } from './tenant-scope.error';
import {
  resetUnscopedQueryReporter,
  setUnscopedQueryReporter,
  withTenantScope,
} from './tenant-scope.extension';

/**
 * The guard, exercised through a real extended client — sprint-03 EVT-018.
 *
 * No database is needed for the refusal path, and that is not a shortcut: the
 * extension throws *before* calling `query(args)`, so a violation never
 * reaches the driver. Testing it against a client pointed at an address
 * nothing is listening on therefore proves something stronger than a passing
 * assertion would with a live connection — if the guard ever stopped
 * throwing, these tests would fail with a connection error rather than
 * silently succeeding.
 *
 * The path where a query *is* allowed through needs a real database and lives
 * in `test/database/tenant-scope.integration-spec.ts`.
 */
const UNREACHABLE = 'postgresql://nobody:nobody@127.0.0.1:1/none?schema=public';

const ORG = 'org_019fb9d8-851b-70b4-95fb-a97f5cb2e970';

describe('tenant scope extension', () => {
  const client = withTenantScope(
    new PrismaClient({
      adapter: new PrismaPg({ connectionString: UNREACHABLE }),
    }),
  );

  afterEach(() => {
    resetUnscopedQueryReporter();
  });

  describe('refuses an unscoped query on a tenant-owned model', () => {
    it('rejects findUnique by id alone', async () => {
      await expect(
        client.event.findUnique({ where: { id: 'evt_1' } }),
      ).rejects.toThrow(TenantScopeViolationError);
    });

    it('rejects findMany with no where', async () => {
      await expect(client.event.findMany()).rejects.toThrow(
        TenantScopeViolationError,
      );
    });

    it('rejects a bare count', async () => {
      await expect(client.event.count()).rejects.toThrow(
        TenantScopeViolationError,
      );
    });

    it('rejects deleteMany with no where', async () => {
      await expect(client.event.deleteMany()).rejects.toThrow(
        TenantScopeViolationError,
      );
    });

    it('rejects a create that sets no organization', async () => {
      await expect(
        client.event.create({
          data: {
            id: 'evt_1',
            name: 'Conference',
            slug: 'conference',
            status: 'DRAFT',
            startsAt: new Date(),
            endsAt: new Date(),
            timezone: 'UTC',
          } as never,
        }),
      ).rejects.toThrow(TenantScopeViolationError);
    });

    it('rejects an EVENT-owned model just as firmly', async () => {
      await expect(
        client.eventSession.findMany({ where: { eventId: 'evt_1' } }),
      ).rejects.toThrow(TenantScopeViolationError);
    });

    /** The clause that mentions the field and still spans every tenant. */
    it('rejects an OR whose branches are not all scoped', async () => {
      await expect(
        client.event.findMany({
          where: { OR: [{ organizationId: ORG }, { slug: 'conference' }] },
        }),
      ).rejects.toThrow(TenantScopeViolationError);
    });

    it('rejects a negated organization filter', async () => {
      await expect(
        client.event.findMany({
          where: { organizationId: { not: ORG } },
        }),
      ).rejects.toThrow(TenantScopeViolationError);
    });
  });

  describe('the error says what to do about it', () => {
    it('names the model and the operation', async () => {
      let error: TenantScopeViolationError | undefined;

      try {
        await client.event.findMany();
      } catch (thrown: unknown) {
        error = thrown as TenantScopeViolationError;
      }

      expect(error).toBeInstanceOf(TenantScopeViolationError);
      expect(error?.model).toBe('Event');
      expect(error?.operation).toBe('findMany');
      expect(error?.message).toContain('organizationId');
      expect(error?.message).toContain('$unscoped');
    });

    /**
     * The relation case gets its own message, or the reader is told to add a
     * column that does not exist on this table.
     */
    it('names the relation when the model is scoped through one', async () => {
      let error: TenantScopeViolationError | undefined;

      try {
        await client.membershipRoleAssignment.findMany();
      } catch (thrown: unknown) {
        error = thrown as TenantScopeViolationError;
      }

      expect(error?.model).toBe('MembershipRoleAssignment');
      expect(error?.message).toContain('through membership');
    });
  });

  /**
   * The guard has to stay out of the way of the models it does not defend, or
   * it would be routed around instead of used. These reach the driver and
   * fail to connect, which is the proof they were not refused.
   */
  describe('lets exempt models through', () => {
    it.each([
      ['Role, GLOBAL-REFERENCE', () => client.role.findMany()],
      ['User, PLATFORM', () => client.user.findMany()],
      ['Organization, PLATFORM', () => client.organization.findMany()],
      ['AuditLog, TENANT_OPTIONAL', () => client.auditLog.findMany()],
    ])('does not refuse %s', async (_label, run) => {
      await expect(run()).rejects.not.toThrow(TenantScopeViolationError);
    });
  });

  describe('$unscoped', () => {
    it('lets an otherwise refused query through', async () => {
      await expect(
        client.$unscoped('platform-wide event report', () =>
          client.event.findMany(),
        ),
      ).rejects.not.toThrow(TenantScopeViolationError);
    });

    it('reports the bypass with the reason it was given', async () => {
      const reported: unknown[] = [];
      setUnscopedQueryReporter((model, operation, reason) => {
        reported.push({ model, operation, reason });
      });

      await client
        .$unscoped('platform-wide event report', () => client.event.findMany())
        .catch(() => undefined);

      expect(reported).toEqual([
        {
          model: 'Event',
          operation: 'findMany',
          reason: 'platform-wide event report',
        },
      ]);
    });

    it('reports nothing for a query that was never at risk', async () => {
      const reported: unknown[] = [];
      setUnscopedQueryReporter((model) => {
        reported.push(model);
      });

      await client
        .$unscoped('platform report', () => client.role.findMany())
        .catch(() => undefined);

      expect(reported).toEqual([]);
    });

    it('stops exempting once it returns', async () => {
      await client
        .$unscoped('platform report', () => client.event.findMany())
        .catch(() => undefined);

      await expect(client.event.findMany()).rejects.toThrow(
        TenantScopeViolationError,
      );
    });

    it('demands a reason', () => {
      expect(() => client.$unscoped('', () => client.event.findMany())).toThrow(
        /requires a reason/,
      );
    });
  });
});
