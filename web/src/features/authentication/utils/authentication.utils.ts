import type { CurrentUser, Role } from "../types";

export function userHasRole(user: CurrentUser | null | undefined, role: Role) {
  return user?.role === role;
}
