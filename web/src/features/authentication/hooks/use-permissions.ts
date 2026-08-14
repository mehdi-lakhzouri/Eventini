"use client";

import { hasPermission } from "@/lib/permissions/permission-checker";
import type { Permission } from "@/lib/permissions/permission.types";
import { useCurrentUser } from "./use-current-user";

/**
 * Les permissions effectives de la session, à usage d'affichage.
 *
 * Livrées par `GET /auth/me` depuis EVT-039. Elles sont **consultatives** :
 * elles évitent de proposer une action qui serait refusée, elles ne décident
 * rien. Le backend rejoue la chaîne complète à chaque requête (AUTH-INV-011),
 * et un client qui forgerait cette liste n'obtiendrait rien de plus.
 *
 * `can` répond `false` pendant le chargement. C'est volontaire et c'est le bon
 * sens de l'erreur pour un affichage : montrer brièvement une action puis la
 * retirer est plus déroutant que l'inverse. `isLoading` reste exposé pour les
 * cas où la distinction compte — préférer un squelette à une absence.
 */
export function usePermissions() {
  const currentUser = useCurrentUser();
  const permissions = currentUser.data?.permissions ?? [];

  return {
    ...currentUser,
    permissions,
    can: (permission: Permission) =>
      hasPermission(permissions as Permission[], permission),
  };
}
