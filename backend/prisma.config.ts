import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration — sprint-03 EVT-014.
 *
 * Prisma 7 moved the datasource URL out of `schema.prisma`: the `datasource`
 * block there no longer carries a `url`, and `env("DATABASE_URL")` inside it
 * is no longer how the CLI is pointed at a database. It reads this file
 * instead. Anything written from Prisma 5/6 memory would fail here, so the
 * shape below follows what `prisma init` generates on 7.9.
 *
 * `dotenv/config` is imported first because the CLI runs outside Nest — none
 * of the application's own configuration or validation is loaded at this
 * point, so `.env` has to be read explicitly.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',

  migrations: {
    path: 'prisma/migrations',
    // The command `prisma migrate reset` and `prisma db seed` run. Kept here
    // rather than in package.json, which is where Prisma 6 and earlier looked
    // and no longer does.
    seed: 'ts-node prisma/seed/index.ts',
  },

  datasource: {
    url: process.env['DATABASE_URL'],

    /**
     * The shadow database is a scratch database Prisma creates, migrates and
     * drops to work out what a migration actually does. `migrate dev` and
     * `migrate diff` need it; `migrate deploy` does not, which is why this is
     * optional and absent in production.
     *
     * It is what makes the `prisma:migrate:diff --exit-code` CI gate
     * meaningful: the gate replays every migration onto an empty database and
     * compares the result against `schema.prisma`, so a schema edited without
     * a matching migration fails the build instead of drifting silently.
     */
    shadowDatabaseUrl: process.env['SHADOW_DATABASE_URL'],
  },
});
