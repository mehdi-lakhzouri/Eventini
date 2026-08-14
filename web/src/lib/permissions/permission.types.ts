/**
 * A permission code, in the `resource.action` form of
 * `docs/database/DATABASE_SCHEMA.md` §5.4 — `events.update`,
 * `attendance.check_in`, `platform.kill_switch.execute`.
 *
 * It lives in `lib/` rather than in the authentication feature on purpose.
 * `permission-checker.ts` needs this type, and `MODULE_DEPENDENCY_MAP.md` §7
 * forbids `lib/` from importing a feature. Declaring it here removes the cycle
 * that previously ran
 *   permission-checker → features/authentication (barrel) → use-permissions →
 *   permission-checker
 * instead of hiding it behind a deeper import path.
 *
 * The authentication feature re-exports it, so consumers keep importing from
 * `@/features/authentication` and nothing about the public surface changes.
 *
 * Kept as a widened `string` while the catalogue is still moving. It narrows to
 * a union generated from the seed in sprint 03 (EVT-017), which is what will
 * make a typo in a permission code a compile error rather than a silent denial.
 */
export type Permission = string;
