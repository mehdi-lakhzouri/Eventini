"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@/i18n/navigation";

import { purgeClientCache } from "@/lib/query/purge-cache";
import { routes } from "@/config/routes";
import {
  activateOrganization,
  listOrganizations,
} from "../api/organizations.api";
import { organizationQueryKeys } from "./query-keys";

export function useOrganizations() {
  return useQuery({
    queryKey: organizationQueryKeys.list,
    queryFn: listOrganizations,
  });
}

/**
 * La bascule d'organisation.
 *
 * 🔴 Le cache est **vidé**, pas invalidé. Une invalidation laisserait les
 * données de l'organisation précédente à l'écran jusqu'à leur remplacement —
 * une fuite cross-tenant côté client, alors même que le backend a rejeté,
 * roté et révoqué comme il fallait. Voir `purgeClientCache`.
 *
 * La purge a lieu **après** la réponse et non avant : échouer sur une
 * organisation suspendue viderait sinon l'écran de l'utilisateur pour une
 * bascule qui n'a pas eu lieu.
 */
export function useActivateOrganization() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: activateOrganization,
    onSuccess: () => {
      purgeClientCache(queryClient);

      /*
        `refresh()` et non `replace()` : la destination ne change pas, seul son
        contenu change. Un `replace` vers la même adresse ne redemanderait rien
        aux Server Components, qui continueraient de rendre l'organisation
        précédente.
      */
      router.replace(routes.adminDashboard);
      router.refresh();
    },
  });
}
