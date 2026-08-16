import type { Env } from '../env.schema';
import type { EnvironmentRule } from './rule.types';
import { coherenceRule } from './coherence.rule';
import { cookiePrefixRule } from './cookie-prefix.rule';
import { keyPairRule } from './key-pair.rule';
import { productionHardeningRule } from './production-hardening.rule';
import { secretHygieneRule } from './secret-hygiene.rule';

export type { EnvironmentRule } from './rule.types';
export { coherenceRule } from './coherence.rule';
export { cookiePrefixRule } from './cookie-prefix.rule';
export { keyPairRule } from './key-pair.rule';
export { productionHardeningRule } from './production-hardening.rule';
export { secretHygieneRule } from './secret-hygiene.rule';

/** The 14 cross-cutting rules of ENVIRONMENT_VARIABLES.md §17. */
export const ENVIRONMENT_RULES: readonly EnvironmentRule[] = [
  productionHardeningRule,
  secretHygieneRule,
  keyPairRule,
  coherenceRule,
  cookiePrefixRule,
];

/**
 * Runs every rule and returns every failure.
 *
 * No rule short-circuits the others. Fixing configuration one restart at a time
 * is the experience §17 explicitly rules out.
 */
export function runEnvironmentRules(env: Env): string[] {
  return ENVIRONMENT_RULES.flatMap((rule) => rule.check(env));
}
