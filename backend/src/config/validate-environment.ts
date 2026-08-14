import { envSchema, type Env } from './env.schema';
import { runEnvironmentRules } from './rules';

export class EnvironmentValidationError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      [
        '',
        '  Environment validation failed. The application will not start.',
        '',
        ...problems.map((problem) => `    - ${problem}`),
        '',
        '  See docs/operations/ENVIRONMENT_VARIABLES.md',
        '  Copy backend/.env.example and fill it in; generate secrets with:',
        '      openssl rand -base64 32',
        '      node scripts/generate-dev-env.mjs   (writes a complete local .env)',
        '',
      ].join('\n'),
    );
    this.name = 'EnvironmentValidationError';
  }
}

/**
 * Validates the environment, or refuses to start.
 *
 * Two passes, deliberately:
 *   1. the zod schema answers "is each value well-formed on its own?";
 *   2. the rules answer "are these values coherent together?".
 *
 * A schema failure skips the rules, because rules operate on parsed values and
 * would otherwise report noise derived from data that never parsed. Within each
 * pass, everything is collected — never the first failure only.
 *
 * ## Why this refuses to start rather than warning
 *
 * A service that boots half-configured is worse than one that refuses to: it
 * answers health probes it cannot honour, takes traffic it will mishandle, and
 * a silent default in production is the ordinary shape of OWASP A05. Exiting
 * non-zero makes the orchestrator retry, fail again, and mark the deployment
 * failed — which is the outcome that gets noticed.
 */
export function validateEnvironment(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => {
      const variable = issue.path.join('.') || '(root)';
      return `${variable}: ${issue.message}`;
    });

    throw new EnvironmentValidationError(problems);
  }

  const ruleFailures = runEnvironmentRules(parsed.data);

  if (ruleFailures.length > 0) {
    throw new EnvironmentValidationError(ruleFailures);
  }

  return parsed.data;
}
