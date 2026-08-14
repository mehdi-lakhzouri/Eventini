"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { changePassword } from "../api/password.api";
import {
  changePasswordSchema,
  type ChangePasswordFormValues,
} from "../schemas/password.schema";
import { applyApiErrorToForm } from "../utils/form-errors";
import { FormField } from "./form-field";
import { FormMessage } from "./form-message";

/**
 * Le changement de mot de passe depuis un compte connecté — EVT-041.
 *
 * `currentPassword` est exigé **malgré** une session valide. Sans lui, un poste
 * laissé déverrouillé quelques minutes suffirait à s'approprier le compte
 * définitivement : le nouveau mot de passe verrouille dehors son propriétaire,
 * et la session volée devient permanente.
 */
export function SecuritySettings() {
  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmation: "" },
    mode: "onSubmit",
  });

  const change = useMutation({ mutationFn: changePassword });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      // `confirmation` reste cliente : le backend n'en veut pas et sa
      // validation refuse toute propriété non déclarée.
      await change.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });

      form.reset();
    } catch (error) {
      applyApiErrorToForm(error, form.setError, {
        knownFields: ["currentPassword", "newPassword"],
      });
    }
  });

  return (
    <section className="space-y-6" aria-labelledby="security-title">
      <header className="space-y-1.5">
        <h2 id="security-title" className="text-lg font-semibold">
          Mot de passe
        </h2>
        <p className="text-sm text-muted-foreground">
          Changer votre mot de passe ne ferme pas vos autres sessions. Utilisez
          « Tout déconnecter » si vous pensez qu&apos;un appareil est compromis.
        </p>
      </header>

      <form onSubmit={onSubmit} noValidate className="max-w-sm space-y-4">
        <FormMessage message={form.formState.errors.root?.message} />

        {change.isSuccess && !form.formState.isDirty ? (
          <p
            role="status"
            className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success"
          >
            Votre mot de passe a été mis à jour.
          </p>
        ) : null}

        <FormField
          id="currentPassword"
          label="Mot de passe actuel"
          type="password"
          autoComplete="current-password"
          error={form.formState.errors.currentPassword}
          {...form.register("currentPassword")}
        />

        <FormField
          id="newPassword"
          label="Nouveau mot de passe"
          type="password"
          autoComplete="new-password"
          hint="Au moins 12 caractères."
          error={form.formState.errors.newPassword}
          {...form.register("newPassword")}
        />

        <FormField
          id="confirmation"
          label="Confirmation"
          type="password"
          autoComplete="new-password"
          error={form.formState.errors.confirmation}
          {...form.register("confirmation")}
        />

        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Enregistrement…" : "Changer le mot de passe"}
        </Button>
      </form>
    </section>
  );
}
