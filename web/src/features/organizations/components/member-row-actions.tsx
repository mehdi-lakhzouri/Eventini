"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { useCurrentUser } from "@/features/authentication";
import { ApiError } from "@/lib/api/api-error";
import { ASSIGNABLE_ROLES } from "../constants/assignable-roles";
import type { useMemberMutations } from "../hooks";
import type { OrganizationMember } from "../types";
import { ConfirmActionDialog } from "./confirm-action-dialog";

type Mutations = ReturnType<typeof useMemberMutations>;

type Pending = "suspend" | "reactivate" | "revoke" | null;

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * Les actions d'une ligne de membre — EVT-046.
 *
 * ## 🔴 Masquer un bouton n'est pas une autorisation
 *
 * Tout ce qui suit décide d'un **affichage**. Le backend rejoue la chaîne
 * complète à chaque requête (AUTH-INV-011) et refuserait de la même façon si
 * ces conditions étaient contournées. Elles existent pour ne pas proposer une
 * action vouée à échouer, pas pour empêcher quoi que ce soit.
 *
 * ## Les transitions proposées suivent celles que le backend accepte
 *
 * ```
 * ACTIVE     → suspendre, révoquer
 * SUSPENDED  → réactiver, révoquer
 * REVOKED    → rien : un départ est définitif (EVT-045), le retour passe
 *              par une nouvelle invitation
 * INVITED    → rien : l'invitation se révoque depuis sa propre table
 * ```
 *
 * Proposer « réactiver » sur un membership révoqué afficherait un bouton qui
 * répond `409`.
 */
export function MemberRowActions({
  member,
  mutations,
  onError,
}: {
  member: OrganizationMember;
  mutations: Mutations;
  onError: (message: string | null) => void;
}) {
  const currentUser = useCurrentUser();
  const [pending, setPending] = useState<Pending>(null);

  /*
    🔴 On n'agit pas sur son propre membership.

    Le backend refuse en `403` (EVT-045) : couper sa propre session en cours
    d'opération est le moindre problème, le vrai est qu'une organisation à un
    seul administrateur se retrouverait sans personne pour la rouvrir. Le
    masquage évite d'offrir un bouton qui ne peut que refuser.
  */
  const isSelf = currentUser.data?.membershipId === member.membershipId;

  if (isSelf) {
    return <span className="text-xs text-muted-foreground">Vous-même</span>;
  }

  const canSuspend = member.status === "ACTIVE";
  const canReactivate = member.status === "SUSPENDED";
  const canRevoke = member.status === "ACTIVE" || member.status === "SUSPENDED";

  const runRoles = (roleCodes: string[]) => {
    onError(null);
    mutations.setRoles.mutate(
      { membershipId: member.membershipId, roleCodes },
      {
        onError: (error) =>
          onError(messageFor(error, "Le rôle n'a pas pu être modifié.")),
      },
    );
  };

  return (
    <div className="flex items-center justify-end gap-2">
      {canRevoke ? (
        <NativeSelect
          size="sm"
          aria-label={`Rôle de ${member.email}`}
          value={member.roleCodes[0] ?? ""}
          disabled={mutations.setRoles.isPending}
          onChange={(event) =>
            runRoles(event.target.value === "" ? [] : [event.target.value])
          }
        >
          <NativeSelectOption value="">Aucun rôle</NativeSelectOption>
          {ASSIGNABLE_ROLES.map((role) => (
            <NativeSelectOption key={role.code} value={role.code}>
              {role.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ) : null}

      {canSuspend ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPending("suspend")}
        >
          Suspendre
        </Button>
      ) : null}

      {canReactivate ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPending("reactivate")}
        >
          Réactiver
        </Button>
      ) : null}

      {canRevoke ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={() => setPending("revoke")}
        >
          Retirer
        </Button>
      ) : null}

      <ConfirmActionDialog
        open={pending === "suspend"}
        onOpenChange={(open) => setPending(open ? "suspend" : null)}
        title={`Suspendre ${member.email} ?`}
        description={
          <>
            L&apos;accès est refusé <strong>immédiatement</strong>, sans
            attendre l&apos;expiration de son jeton. Ses sessions ne sont pas
            fermées : la réactivation lui rendra l&apos;accès sans qu&apos;il
            ait à se reconnecter.
          </>
        }
        confirmLabel="Suspendre"
        withReason
        isPending={mutations.suspend.isPending}
        onConfirm={(reason) => {
          onError(null);
          mutations.suspend.mutate(
            { membershipId: member.membershipId, reason },
            {
              onSuccess: () => setPending(null),
              onError: (error) =>
                onError(messageFor(error, "La suspension a échoué.")),
            },
          );
        }}
      />

      <ConfirmActionDialog
        open={pending === "reactivate"}
        onOpenChange={(open) => setPending(open ? "reactivate" : null)}
        title={`Réactiver ${member.email} ?`}
        description="Ses droits lui sont rendus immédiatement, sur ses sessions existantes."
        confirmLabel="Réactiver"
        isPending={mutations.reactivate.isPending}
        onConfirm={() => {
          onError(null);
          mutations.reactivate.mutate(
            { membershipId: member.membershipId },
            {
              onSuccess: () => setPending(null),
              onError: (error) =>
                onError(messageFor(error, "La réactivation a échoué.")),
            },
          );
        }}
      />

      <ConfirmActionDialog
        open={pending === "revoke"}
        onOpenChange={(open) => setPending(open ? "revoke" : null)}
        title={`Retirer ${member.email} de l'organisation ?`}
        description={
          <>
            Ses sessions sont <strong>fermées</strong> et ses accès aux
            événements retirés. Le départ est définitif : son retour passera par
            une nouvelle invitation. La ligne est conservée dans
            l&apos;historique, jamais supprimée.
          </>
        }
        confirmLabel="Retirer"
        destructive
        withReason
        isPending={mutations.revoke.isPending}
        onConfirm={(reason) => {
          onError(null);
          mutations.revoke.mutate(
            { membershipId: member.membershipId, reason },
            {
              onSuccess: () => setPending(null),
              onError: (error) =>
                onError(messageFor(error, "Le retrait a échoué.")),
            },
          );
        }}
      />
    </div>
  );
}
