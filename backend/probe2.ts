import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from './src/infrastructure/database/prisma/generated/client';

const seen: string[] = [];
const probe = Prisma.defineExtension({
  name: 'probe',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }: any) {
        seen.push(`${model}.${operation} ${JSON.stringify(args)}`);
        return query(args);
      },
    },
  },
});

async function main() {
  const base = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL'] }) });
  const c = base.$extends(probe);

  // extendedWhereUnique: non-unique field alongside the unique one?
  try {
    await c.event.findUnique({ where: { id: 'evt_x', organizationId: 'org_x' } as any });
    console.log('extendedWhereUnique: ACCEPTED');
  } catch (e) { console.log('extendedWhereUnique: REJECTED ->', String(e).slice(0, 140)); }

  // nested write: does the child model fire its own operation?
  const mark = seen.length;
  try {
    await c.organization.findMany({ where: {}, include: { memberships: true } } as any);
  } catch (e) { console.log('include err', String(e).slice(0,100)); }
  console.log('ops for a findMany with include:', seen.length - mark);

  // groupBy / aggregate arg shapes with where
  await c.role.aggregate({ _count: true, where: { scope: 'EVENT' } });
  await c.role.groupBy({ by: ['scope'], where: { isSystem: true } });

  for (const l of seen) console.log('  ', l);
  await base.$disconnect();
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
