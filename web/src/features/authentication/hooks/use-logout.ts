"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { routes } from "@/config/routes";
import { purgeClientCache } from "@/lib/query/purge-cache";
import { logout } from "../api/authentication.api";

/**
 * La déconnexion — EVT-041.
 *
 * 🔴 Le cache est **vidé**, pas invalidé. Une invalidation laisserait les
 * données du compte précédent à l'écran jusqu'à leur remplacement : sur un
 * poste partagé, la personne suivante verrait les participants, les
 * inscriptions et les noms de celle qui vient de se déconnecter.
 *
 * La purge a lieu même si l'appel échoue. Une déconnexion qui n'aboutit pas
 * côté serveur — réseau coupé, session déjà expirée — doit malgré tout
 * effacer l'écran : l'utilisateur a demandé à partir, et lui laisser ses
 * données affichées est le pire des deux résultats possibles.
 */
export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();

  const leave = () => {
    purgeClientCache(queryClient);
    router.replace(routes.login);
  };

  return useMutation({
    mutationFn: logout,
    onSuccess: leave,
    onError: leave,
  });
}
