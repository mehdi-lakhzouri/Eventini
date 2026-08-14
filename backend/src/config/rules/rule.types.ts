import type { Env } from '../env.schema';

/**
 * A cross-cutting environment rule.
 *
 * Every rule returns *all* the problems it found rather than throwing on the
 * first one. Reporting one missing variable per restart turns configuring a
 * deployment into a guessing game; ENVIRONMENT_VARIABLES.md §17 requires the
 * complete list in a single message.
 */
export interface EnvironmentRule {
  /** Rule number from ENVIRONMENT_VARIABLES.md §17, for traceability. */
  readonly id: string;
  readonly description: string;
  check(env: Env): string[];
}
