import {
  dataHasOrganizationScope,
  hasOrganizationScope,
  isScopingConstraint,
  whereHasOrganizationScope,
} from './organization-scope';

const ORG = 'org_019fb9d8-851b-70b4-95fb-a97f5cb2e970';
const OTHER = 'org_019fb9d8-9999-70b4-95fb-a97f5cb2e970';

describe('isScopingConstraint', () => {
  it.each([
    ['a literal id', ORG],
    ['an equals filter', { equals: ORG }],
    ['an in filter', { in: [ORG, OTHER] }],
  ])('accepts %s', (_label, value) => {
    expect(isScopingConstraint(value)).toBe(true);
  });

  /**
   * These are the dangerous ones. Each mentions `organizationId`, so a check
   * that only asked "is the field present" would pass every one of them —
   * and `not` selects precisely every tenant except the caller's.
   */
  it.each([
    ['a not filter', { not: ORG }],
    ['a notIn filter', { notIn: [ORG] }],
    ['an empty in filter', { in: [] }],
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['an empty object', {}],
    ['a contains filter', { contains: 'org_' }],
    ['a startsWith filter', { startsWith: 'org_' }],
    ['an array', [ORG]],
    ['a number', 42],
  ])('rejects %s', (_label, value) => {
    expect(isScopingConstraint(value)).toBe(false);
  });

  it('rejects an in filter holding anything that is not an id', () => {
    expect(isScopingConstraint({ in: [ORG, null] })).toBe(false);
    expect(isScopingConstraint({ in: [ORG, ''] })).toBe(false);
  });
});

describe('whereHasOrganizationScope', () => {
  it('accepts a direct constraint', () => {
    expect(whereHasOrganizationScope({ organizationId: ORG })).toBe(true);
  });

  it('accepts it alongside other filters', () => {
    expect(
      whereHasOrganizationScope({ id: 'evt_1', organizationId: ORG }),
    ).toBe(true);
  });

  it.each([
    ['no where at all', undefined],
    ['an empty where', {}],
    ['a where on the id only', { id: 'evt_1' }],
    ['null', null],
    ['an array', [{ organizationId: ORG }]],
  ])('rejects %s', (_label, where) => {
    expect(whereHasOrganizationScope(where)).toBe(false);
  });

  describe('AND narrows, so one scoped branch is enough', () => {
    it('accepts an array form', () => {
      expect(
        whereHasOrganizationScope({
          AND: [{ status: 'ACTIVE' }, { organizationId: ORG }],
        }),
      ).toBe(true);
    });

    it('accepts an object form', () => {
      expect(whereHasOrganizationScope({ AND: { organizationId: ORG } })).toBe(
        true,
      );
    });

    it('accepts a nested one', () => {
      expect(
        whereHasOrganizationScope({
          AND: [{ AND: [{ organizationId: ORG }] }],
        }),
      ).toBe(true);
    });

    it('rejects one where no branch scopes', () => {
      expect(
        whereHasOrganizationScope({
          AND: [{ status: 'ACTIVE' }, { id: 'evt_1' }],
        }),
      ).toBe(false);
    });
  });

  /**
   * The single most plausible way to write an unscoped query that looks
   * scoped. `OR` widens, so a branch without the constraint returns rows from
   * every tenant — and the clause still contains the word `organizationId`.
   */
  describe('OR widens, so every branch must scope', () => {
    it('rejects a mixed OR', () => {
      expect(
        whereHasOrganizationScope({
          OR: [{ organizationId: ORG }, { id: 'evt_1' }],
        }),
      ).toBe(false);
    });

    it('accepts an OR where every branch scopes', () => {
      expect(
        whereHasOrganizationScope({
          OR: [
            { organizationId: ORG, status: 'ACTIVE' },
            { organizationId: ORG, status: 'DRAFT' },
          ],
        }),
      ).toBe(true);
    });

    it('rejects an empty OR', () => {
      expect(whereHasOrganizationScope({ OR: [] })).toBe(false);
    });

    it('accepts a top-level constraint regardless of the OR', () => {
      expect(
        whereHasOrganizationScope({
          organizationId: ORG,
          OR: [{ status: 'ACTIVE' }, { status: 'DRAFT' }],
        }),
      ).toBe(true);
    });
  });

  /** A negation cannot bound a query to a tenant. */
  it('never treats a NOT as evidence of scope', () => {
    expect(whereHasOrganizationScope({ NOT: { organizationId: ORG } })).toBe(
      false,
    );
    expect(whereHasOrganizationScope({ NOT: [{ organizationId: ORG }] })).toBe(
      false,
    );
  });

  /**
   * §2.4 denormalises `organization_id` onto every tenant-owned table so the
   * guard needs no join. Accepting a relation filter would reward the query
   * shape that column exists to make unnecessary.
   */
  it('does not accept a relation filter in place of the column', () => {
    expect(whereHasOrganizationScope({ organization: { id: ORG } })).toBe(
      false,
    );
    expect(
      whereHasOrganizationScope({ organization: { is: { id: ORG } } }),
    ).toBe(false);
  });
});

describe('dataHasOrganizationScope', () => {
  it('accepts the foreign key written directly', () => {
    expect(dataHasOrganizationScope({ organizationId: ORG })).toBe(true);
  });

  /** Prisma's idiomatic relation form still writes the same column. */
  it('accepts a connect', () => {
    expect(
      dataHasOrganizationScope({ organization: { connect: { id: ORG } } }),
    ).toBe(true);
  });

  it.each([
    ['an empty payload', {}],
    ['an empty id', { organizationId: '' }],
    ['a connect with no id', { organization: { connect: {} } }],
    ['a create instead of a connect', { organization: { create: {} } }],
    ['null', null],
  ])('rejects %s', (_label, data) => {
    expect(dataHasOrganizationScope(data)).toBe(false);
  });
});

describe('hasOrganizationScope', () => {
  describe('reads and mutations, gated on where', () => {
    it.each([
      'findUnique',
      'findUniqueOrThrow',
      'findFirst',
      'findFirstOrThrow',
      'findMany',
      'count',
      'aggregate',
      'groupBy',
      'update',
      'updateMany',
      'delete',
      'deleteMany',
    ])('accepts a scoped %s', (operation) => {
      expect(
        hasOrganizationScope(operation, { where: { organizationId: ORG } })
          .scoped,
      ).toBe(true);
    });

    it.each(['findMany', 'count', 'deleteMany', 'updateMany'])(
      'refuses %s with no where at all',
      (operation) => {
        const verdict = hasOrganizationScope(operation, {});

        expect(verdict.scoped).toBe(false);
        expect(verdict.reason).toContain('where');
      },
    );

    /**
     * `findUnique({ where: { id } })` is the exact call ADR-0003 was written
     * against. Prisma's extended `where` accepts non-unique fields alongside
     * the unique one — verified against a live client — so the scoped form is
     * available and there is no reason to grant an exception here.
     */
    it('refuses a findUnique by id alone', () => {
      expect(
        hasOrganizationScope('findUnique', { where: { id: 'evt_1' } }).scoped,
      ).toBe(false);
    });
  });

  describe('creates, gated on data', () => {
    it('accepts a scoped create', () => {
      expect(
        hasOrganizationScope('create', { data: { organizationId: ORG } })
          .scoped,
      ).toBe(true);
    });

    it('refuses a create that sets no organization', () => {
      const verdict = hasOrganizationScope('create', {
        data: { name: 'Conference' },
      });

      expect(verdict.scoped).toBe(false);
      expect(verdict.reason).toContain('data');
    });

    it('accepts a createMany where every row is scoped', () => {
      expect(
        hasOrganizationScope('createMany', {
          data: [{ organizationId: ORG }, { organizationId: ORG }],
        }).scoped,
      ).toBe(true);
    });

    /** One unscoped row is one row belonging to nobody. */
    it('refuses a createMany where a single row is unscoped', () => {
      expect(
        hasOrganizationScope('createMany', {
          data: [{ organizationId: ORG }, { name: 'orphan' }],
        }).scoped,
      ).toBe(false);
    });

    it('accepts a createMany of nothing', () => {
      expect(hasOrganizationScope('createMany', { data: [] }).scoped).toBe(
        true,
      );
    });
  });

  /**
   * `upsert` is the one operation with two payloads that can disagree: a
   * scoped `where` finds nothing, so the unscoped `create` runs and writes a
   * row with no owner.
   */
  describe('upsert, gated on both sides', () => {
    it('accepts when where and create are both scoped', () => {
      expect(
        hasOrganizationScope('upsert', {
          where: { organizationId: ORG, id: 'evt_1' },
          create: { organizationId: ORG },
          update: {},
        }).scoped,
      ).toBe(true);
    });

    it('refuses a scoped where with an unscoped create', () => {
      const verdict = hasOrganizationScope('upsert', {
        where: { organizationId: ORG, id: 'evt_1' },
        create: { name: 'orphan' },
        update: {},
      });

      expect(verdict.scoped).toBe(false);
      expect(verdict.reason).toContain('create');
    });

    it('refuses an unscoped where', () => {
      expect(
        hasOrganizationScope('upsert', {
          where: { id: 'evt_1' },
          create: { organizationId: ORG },
          update: {},
        }).scoped,
      ).toBe(false);
    });
  });

  it('refuses args that are not an object', () => {
    expect(hasOrganizationScope('findMany', undefined).scoped).toBe(false);
    expect(hasOrganizationScope('findMany', null).scoped).toBe(false);
  });
});
