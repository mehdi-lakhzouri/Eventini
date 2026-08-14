import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';

/**
 * Tracks whether application initialisation has finished.
 *
 * `onApplicationBootstrap` is the last lifecycle hook Nest runs, after every
 * module's `onModuleInit`, so it is the only point at which "the container is
 * fully built" is true. Anything earlier would report ready while providers
 * are still being constructed.
 *
 * This exists so a slow start is not mistaken for a dead process. A startup
 * probe lets the orchestrator wait — with a generous budget — while the
 * application connects and warms, and only then hand over to the liveness
 * probe with its short, aggressive timings. Without the split, either the
 * liveness timeout has to be loose enough to cover the worst startup (so a
 * genuinely hung process is left running for minutes), or a slow start is
 * killed and retried forever.
 */
@Injectable()
export class StartupState implements OnApplicationBootstrap {
  private started = false;

  onApplicationBootstrap(): void {
    this.started = true;
  }

  get hasStarted(): boolean {
    return this.started;
  }
}
