/**
 * The barrel seven files already imported as `../types` and that did not exist.
 *
 * `authentication.api.ts`, `mfa.api.ts`, `password.api.ts`, `sessions.api.ts`,
 * `auth-guard.tsx`, `use-permissions.ts` and `authentication.utils.ts` all
 * resolved to nothing (TS2307), which is why `npm run typecheck` reported ten
 * errors before this ticket.
 *
 * One file per API surface, mirroring `../api/`:
 *   authentication.types.ts ↔ authentication.api.ts
 *   mfa.types.ts            ↔ mfa.api.ts
 *   password.types.ts       ↔ password.api.ts
 *   session.types.ts        ↔ sessions.api.ts
 *   permission.types.ts     → re-export from @/lib/permissions
 */
export type {
  AuthenticationLevel,
  CurrentUser,
  LoginInput,
  Role,
  SessionClientType,
  SessionCreated,
  UserStatus,
} from "./authentication.types";

export type { MfaVerificationInput } from "./mfa.types";

export type {
  ChangePasswordInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from "./password.types";

export type { Permission } from "./permission.types";

export type { UserSession } from "./session.types";
