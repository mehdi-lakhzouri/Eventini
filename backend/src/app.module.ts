import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { configurationNamespaces, validateEnvironment } from './config';
import { IdentityModule } from './modules/identity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: configurationNamespaces,
      // Runs before anything else is constructed. A failure throws and the
      // process exits non-zero rather than starting half-configured.
      validate: validateEnvironment,
      // .env is for local development only; deployed environments inject real
      // variables. Ignoring the file in production stops a stray one on the
      // host from quietly overriding them.
      envFilePath: ['.env'],
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      cache: true,
      // No `expandVariables`: interpolation would let one secret reference
      // another, which is exactly what the reuse check (rule 8) exists to catch.
    }),
    IdentityModule,
  ],
})
export class AppModule {}
