"use client";

import { hasPermission } from "@/lib/permissions/permission-checker";
import { useCurrentUser } from "./use-current-user";
import type { Permission } from "../types";

/**
 * 🔴 **Les permissions ne traversent pas encore jusqu'au client.**
 *
 * `GET /auth/me` ne renvoie pas de liste de permissions, et aucune autre route
 * n'en expose — vérifié le 14 août 2026. La version précédente lisait
 * `currentUser.data?.permissions ?? []`, un champ que le type déclarait à tort :
 * `can()` répondait donc **toujours `false`**, en silence.
 *
 * C'est le pire des deux comportements possibles. Une interface qui masque
 * systématiquement les actions autorisées est indiscernable, pour l'utilisateur,
 * d'une interface cassée — et le développeur qui teste avec un compte
 * administrateur ne voit rien non plus.
 *
 * `can()` n'est donc **pas** exposé tant qu'il n'a rien à lire. Une fonction
 * qui répond à une question d'autorisation sans disposer de la donnée ne peut
 * que mentir, et un appelant ne distingue pas « non autorisé » de « je ne sais
 * pas ». Il n'existe aucun appelant aujourd'hui : rien n'est cassé par son
 * absence, alors qu'un `can()` toujours faux serait passé inaperçu.
 *
 * `known` rend l'ignorance interrogeable, et `canWith` garde la vérification
 * elle-même prête à être branchée.
 *
 * EVT-039 tranche la source. Rappel pour ce choix — le frontend n'est jamais
 * une frontière de sécurité (AUTH-INV-011) : en cas de doute, afficher et
 * laisser le backend refuser coûte un 403 que l'utilisateur aurait reçu de
 * toute façon, là que masquer prive un ayant droit sans trace.
 */
export function usePermissions() {
  const currentUser = useCurrentUser();

  return {
    ...currentUser,
    /** Faux tant qu'aucune route ne livre les permissions effectives. */
    known: false as const,
    /**
     * La vérification, prête pour EVT-039 : il ne restera qu'à lui fournir la
     * liste réelle, sans réécrire la logique de correspondance.
     */
    canWith: (permissions: readonly string[], permission: Permission) =>
      hasPermission([...permissions], permission),
  };
}
