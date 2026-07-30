import type { Permission } from "./permission.types";

/**
 * Pure membership test. Deliberately knows nothing about the current user, the
 * active organization, or how the permissions were obtained.
 *
 * This is a UX helper, never a security boundary: it decides whether to render
 * an action, not whether the action is allowed. The backend re-evaluates the
 * full eight-step chain on every request (AUTH-INV-011).
 */
export function hasPermission(
  permissions: readonly Permission[],
  requiredPermission: Permission,
): boolean {
  return permissions.includes(requiredPermission);
}

/**
 * True when every required permission is held. An empty requirement list is
 * satisfied — "this action needs nothing" is not the same as "deny".
 */
export function hasEveryPermission(
  permissions: readonly Permission[],
  requiredPermissions: readonly Permission[],
): boolean {
  return requiredPermissions.every((required) =>
    hasPermission(permissions, required),
  );
}

/**
 * True when at least one required permission is held.
 *
 * An empty requirement list returns **false**, not true: reaching this helper
 * with nothing to check means the caller built its requirements wrongly, and
 * failing closed is the safer reading.
 */
export function hasAnyPermission(
  permissions: readonly Permission[],
  requiredPermissions: readonly Permission[],
): boolean {
  return requiredPermissions.some((required) =>
    hasPermission(permissions, required),
  );
}
