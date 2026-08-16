"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  listMembers,
  reactivateMember,
  replaceMemberRoles,
  revokeMember,
  suspendMember,
} from "../api/members.api";
import { organizationQueryKeys } from "./query-keys";

export function useMembers(organizationId: string | undefined) {
  return useQuery({
    queryKey: organizationQueryKeys.members(organizationId ?? ""),
    queryFn: () => listMembers(organizationId as string),
    enabled: organizationId !== undefined,
  });
}

/**
 * Les quatre mutations d'un membre, réunies par ce qu'elles invalident.
 *
 * Toutes touchent la même liste, et un changement de rôle change aussi les
 * permissions **de l'intéressé** — pas de l'appelant, dont la session n'est pas
 * concernée. Rien à purger côté client, donc : une invalidation suffit, là où
 * la bascule d'organisation exige une purge complète (voir
 * `useActivateOrganization`).
 */
export function useMemberMutations(organizationId: string) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: organizationQueryKeys.members(organizationId),
    });
  };

  const setRoles = useMutation({
    mutationFn: (input: { membershipId: string; roleCodes: string[] }) =>
      replaceMemberRoles({ organizationId, ...input }),
    onSuccess: invalidate,
  });

  const suspend = useMutation({
    mutationFn: (input: { membershipId: string; reason: string | null }) =>
      suspendMember({ organizationId, ...input }),
    onSuccess: invalidate,
  });

  const reactivate = useMutation({
    mutationFn: (input: { membershipId: string }) =>
      reactivateMember({ organizationId, ...input }),
    onSuccess: invalidate,
  });

  /*
    La révocation coupe les sessions et les assignations d'événement du membre
    retiré (EVT-045). Elle n'invalide donc pas seulement la liste : le compte
    des places occupées, qui vit sur la fiche de l'organisation, change aussi.
  */
  const revoke = useMutation({
    mutationFn: (input: { membershipId: string; reason: string | null }) =>
      revokeMember({ organizationId, ...input }),
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({
        queryKey: organizationQueryKeys.detail(organizationId),
      });
    },
  });

  return { setRoles, suspend, reactivate, revoke };
}
