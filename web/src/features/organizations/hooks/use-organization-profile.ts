"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getOrganization, updateOrganization } from "../api/organizations.api";
import type { VersionedOrganization } from "../types";
import { organizationQueryKeys } from "./query-keys";

/** `GET /organizations/{id}` — la fiche et son `ETag`, gardés ensemble. */
export function useOrganizationProfile(organizationId: string | undefined) {
  return useQuery({
    queryKey: organizationQueryKeys.detail(organizationId ?? ""),
    queryFn: () => getOrganization(organizationId as string),
    enabled: organizationId !== undefined,
  });
}

/**
 * L'enregistrement des réglages, avec son verrou optimiste.
 *
 * ## 🔴 L'`ETag` vient du cache, pas d'un état local
 *
 * `If-Match` est obligatoire (EVT-032) et doit porter la version **réellement
 * lue**. Le garder dans un `useState` du formulaire le figerait au premier
 * rendu : après un premier enregistrement réussi, la version en base a avancé,
 * l'état local non, et le second enregistrement récolterait un `409` alors que
 * personne d'autre n'a touché à la fiche.
 *
 * D'où la lecture depuis le cache au moment de muter, et l'écriture du
 * résultat — nouvel `ETag` compris — dans ce même cache au retour. Le cycle se
 * referme sur lui-même et le formulaire n'a rien à mémoriser.
 */
export function useUpdateOrganization(organizationId: string) {
  const queryClient = useQueryClient();
  const key = organizationQueryKeys.detail(organizationId);

  return useMutation({
    mutationFn: (changes: { name?: string; slug?: string }) => {
      const cached = queryClient.getQueryData<VersionedOrganization>(key);

      if (cached?.etag == null) {
        /*
          Sans `ETag`, la requête partirait sans `If-Match` et reviendrait en
          `428`. Échouer ici est plus lisible : le message dit quoi faire, là
          où un `428` remonterait comme une erreur de protocole.
        */
        return Promise.reject(
          new Error(
            "La fiche n'a pas encore été chargée. Rechargez la page avant d'enregistrer.",
          ),
        );
      }

      return updateOrganization({
        organizationId,
        etag: cached.etag,
        changes,
      });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<VersionedOrganization>(key, updated);

      /*
        Le nom de l'organisation apparaît dans le sélecteur de contexte, qui
        lit une autre requête. L'invalider évite qu'un renommage réussi laisse
        l'ancien nom dans la barre latérale jusqu'au prochain chargement.
      */
      void queryClient.invalidateQueries({
        queryKey: organizationQueryKeys.list,
      });
    },
  });
}
