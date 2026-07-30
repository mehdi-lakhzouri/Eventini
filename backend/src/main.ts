import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}

// A rejected bootstrap must terminate the process with a non-zero code so the
// orchestrator restarts, fails again, and marks the deployment failed. An
// unhandled rejection would leave a half-started process answering health
// probes it cannot honour — worse than not starting at all.
//
// EVT-009 replaces this console call with a Pino `fatal` and the ten-step
// shutdown of PINO_LOGGING_SPECIFICATION.md §29. Handling the rejection is
// EVT-002's concern; how it is reported is EVT-009's.
bootstrap().catch((error: unknown) => {
  console.error('Application bootstrap failed', error);
  process.exit(1);
});
