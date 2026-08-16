"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createInvitation,
  listInvitations,
  revokeInvitation,
} from "../api/invitations.api";
import { organizationQueryKeys } from "./query-keys";

export function useInvitations(organizationId: string | undefined) {
  return useQuery({
    queryKey: organizationQueryKeys.invitations(organizationId ?? ""),
    queryFn: () => listInvitations(organizationId as string),
    enabled: organizationId !== undefined,
  });
}

export function useInvitationMutations(organizationId: string) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: organizationQueryKeys.invitations(organizationId),
    });
  };

  /*
    🔴 `data` porte `acceptanceToken`, rendu une seule fois par le backend.
    L'invalidation qui suit ne le récupérera pas — `GET` ne le renvoie jamais,
    la base n'en ayant que l'empreinte. L'appelant doit donc l'afficher depuis
    ce résultat de mutation, et nulle part ailleurs.
  */
  const create = useMutation({
    mutationFn: (input: { email: string; roleCode: string }) =>
      createInvitation({ organizationId, ...input }),
    onSuccess: invalidate,
  });

  const revoke = useMutation({
    mutationFn: (input: { invitationId: string }) =>
      revokeInvitation({ organizationId, ...input }),
    onSuccess: invalidate,
  });

  return { create, revoke };
}
