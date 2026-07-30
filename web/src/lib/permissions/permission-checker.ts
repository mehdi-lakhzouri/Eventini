import type { Permission } from "@/features/authentication";

export function hasPermission(
  permissions: readonly Permission[],
  requiredPermission: Permission,
) {
  return permissions.includes(requiredPermission);
}
