export { applicationConfig } from './application.config';
export { authenticationConfig } from './authentication.config';
export { cookiesConfig } from './cookies.config';
export { csrfConfig } from './csrf.config';
export { databaseConfig } from './database.config';
export { rateLimitConfig } from './rate-limit.config';
export { redisConfig } from './redis.config';

export { envSchema, type Env } from './env.schema';
export {
  validateEnvironment,
  EnvironmentValidationError,
} from './validate-environment';
export { ENVIRONMENT_RULES, runEnvironmentRules } from './rules';
export type { EnvironmentRule } from './rules';
export { getValidatedEnv, resetValidatedEnvCache } from './validated-env';

import { applicationConfig } from './application.config';
import { authenticationConfig } from './authentication.config';
import { cookiesConfig } from './cookies.config';
import { csrfConfig } from './csrf.config';
import { databaseConfig } from './database.config';
import { rateLimitConfig } from './rate-limit.config';
import { redisConfig } from './redis.config';

/** Every namespace, for `ConfigModule.forRoot({ load: configurationNamespaces })`. */
export const configurationNamespaces = [
  applicationConfig,
  authenticationConfig,
  cookiesConfig,
  csrfConfig,
  databaseConfig,
  rateLimitConfig,
  redisConfig,
];
