"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { routes } from "@/config/routes";
import { resetPassword } from "../api/password.api";
import {
  resetPasswordSchema,
  type ResetPasswordFormValues,
} from "../schemas/password.schema";
import { applyApiErrorToForm } from "../utils/form-errors";
import { FormField } from "./form-field";
import { FormMessage } from "./form-message";

/**
 * La réinitialisation proprement dite — EVT-040.
 *
 * Le jeton vient de l'URL du courriel. Il est à **usage unique** et vit
 * 30 minutes (ADR-0009), ce qui explique deux choix de cet écran : la
 * confirmation du mot de passe est exigée côté client — une faute de frappe sur
 * un champ masqué ne se rattrape pas, le jeton étant consommé — et l'échec
 * renvoie vers une nouvelle demande plutôt que d'inviter à réessayer.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, newPassword: "", confirmation: "" },
    mode: "onSubmit",
  });

  const reset = useMutation({ mutationFn: resetPassword });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      // `confirmation` ne part pas : elle n'existe que pour ce formulaire, et
      // la validation backend refuse toute propriété non déclarée.
      await reset.mutateAsync({
        token: values.token,
        newPassword: values.newPassword,
      });

      router.replace(routes.login);
    } catch (error) {
      applyApiErrorToForm(error, form.setError, {
        knownFields: ["newPassword", "token"],
      });
    }
  });

  if (token === "") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          Lien incomplet
        </h1>
        <p className="text-sm text-muted-foreground">
          Ce lien de réinitialisation est incomplet. Demandez-en un nouveau.
        </p>
        <Button
          size="lg"
          className="w-full"
          onClick={() => router.replace(routes.forgotPassword)}
        >
          Demander un nouveau lien
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">
          Nouveau mot de passe
        </h1>
        <p className="text-sm text-muted-foreground">
          Choisissez un mot de passe que vous n&apos;utilisez nulle part
          ailleurs.
        </p>
      </header>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormMessage message={form.formState.errors.root?.message} />

        <FormField
          id="newPassword"
          label="Nouveau mot de passe"
          type="password"
          autoComplete="new-password"
          autoFocus
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

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </form>
    </div>
  );
}
