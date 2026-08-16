"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { applyApiErrorToForm } from "@/features/authentication";
import {
  ASSIGNABLE_ROLES,
  DEFAULT_INVITATION_ROLE,
} from "../constants/assignable-roles";
import { useInvitationMutations } from "../hooks";
import {
  inviteMemberSchema,
  type InviteMemberInput,
} from "../schemas/organization.schema";
import { AcceptanceLinkNotice } from "./acceptance-link-notice";

/**
 * L'invitation d'un membre — EVT-046.
 *
 * ## 🔴 Le lien d'acceptation ne s'affiche qu'une fois
 *
 * `POST /organizations/{id}/invitations` renvoie `acceptanceToken`, et c'est la
 * **seule** occasion de le voir : la base n'en garde que l'empreinte HMAC
 * (EVT-043). Ni un rechargement, ni le `GET` de la liste ne le retrouveront.
 *
 * C'est un état de transition assumé tant qu'EVT-073 n'envoie pas les
 * courriels — et il a une conséquence de sécurité que le backend documente :
 * l'invitant voit le jeton, donc il peut accepter l'invitation à la place de
 * l'invité. La possession du jeton cesse de prouver le contrôle de la boîte.
 * L'écran le dit plutôt que de le taire.
 */
export function InviteMemberForm({ organizationId }: { organizationId: string }) {
  const { create } = useInvitationMutations(organizationId);
  const [issued, setIssued] = useState<{ email: string; token: string } | null>(
    null,
  );

  const form = useForm<InviteMemberInput>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: { email: "", roleCode: DEFAULT_INVITATION_ROLE },
  });

  const onSubmit = form.handleSubmit((values) => {
    create.mutate(values, {
      onSuccess: (invitation) => {
        setIssued({
          email: invitation.email,
          token: invitation.acceptanceToken,
        });
        form.reset({ email: "", roleCode: values.roleCode });
      },
      /*
        Le backend renvoie `roleCode` en `field` sur un rôle inconnu **ou**
        plateforme — les deux tombent dans la même branche pour ne pas
        énumérer le catalogue auquel l'appelant n'a pas droit. Le helper place
        le message sous le champ concerné, et se rabat sur `root` quand aucun
        champ de ce formulaire n'est visé.
      */
      onError: (error) =>
        applyApiErrorToForm(error, form.setError, {
          knownFields: ["email", "roleCode"],
        }),
    });
  });

  const rootError = form.formState.errors.root?.message ?? null;

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="flex flex-wrap items-start gap-3">
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label htmlFor="invite-email">Adresse électronique</Label>
          <Input
            id="invite-email"
            type="email"
            autoComplete="off"
            placeholder="personne@exemple.fr"
            aria-invalid={form.formState.errors.email !== undefined}
            {...form.register("email")}
          />
          {form.formState.errors.email ? (
            <p role="alert" className="text-sm text-destructive">
              {form.formState.errors.email.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="invite-role">Rôle</Label>
          <NativeSelect id="invite-role" {...form.register("roleCode")}>
            {ASSIGNABLE_ROLES.map((role) => (
              <NativeSelectOption key={role.code} value={role.code}>
                {role.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {form.formState.errors.roleCode ? (
            <p role="alert" className="text-sm text-destructive">
              {form.formState.errors.roleCode.message}
            </p>
          ) : null}
        </div>

        <Button type="submit" className="mt-6" disabled={create.isPending}>
          {create.isPending ? "Envoi…" : "Inviter"}
        </Button>
      </form>

      {rootError === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {rootError}
        </p>
      )}

      {issued === null ? null : (
        <AcceptanceLinkNotice
          email={issued.email}
          token={issued.token}
          onDismiss={() => setIssued(null)}
        />
      )}
    </div>
  );
}
