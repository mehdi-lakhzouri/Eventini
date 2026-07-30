"use client";

import { hasPermission } from "@/lib/permissions/permission-checker";
import { useCurrentUser } from "./use-current-user";
import type { Permission } from "../types";

export function usePermissions() {
  const currentUser = useCurrentUser();

  return {
    ...currentUser,
    can: (permission: Permission) =>
      hasPermission(currentUser.data?.permissions ?? [], permission),
  };
}
