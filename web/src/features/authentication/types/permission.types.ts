/**
 * Re-exported so consumers keep importing `Permission` from
 * `@/features/authentication` rather than reaching into `lib/`.
 *
 * The declaration itself lives in `@/lib/permissions` because
 * `permission-checker.ts` needs it and `MODULE_DEPENDENCY_MAP.md` §7 forbids
 * `lib/` from importing a feature. Re-exporting keeps the public surface stable
 * while the dependency runs in the allowed direction: feature → lib.
 *
 * `MfaVerificationInput`, `ForgotPasswordInput` and `ResetPasswordInput` used
 * to live here despite having nothing to do with permissions. They moved to
 * `mfa.types.ts` and `password.types.ts`, so `types/` now mirrors `api/`.
 */
export type { Permission } from "@/lib/permissions/permission.types";
