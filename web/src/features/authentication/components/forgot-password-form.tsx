"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { routes } from "@/config/routes";
import { requestPasswordReset } from "../api/password.api";
import {
  forgotPasswordSchema,
  type ForgotPasswordFormValues,
} from "../schemas/password.schema";
import { applyApiErrorToForm } from "../utils/form-errors";
import { FormField } from "./form-field";
import { FormMessage } from "./form-message";

/**
 * La demande de réinitialisation — EVT-040.
 *
 * 🔴 **La confirmation est identique que l'adresse existe ou non.**
 *
 * Le backend répond systématiquement 202 pour la même raison, et l'écran doit
 * tenir la même ligne. Afficher « aucun compte pour cette adresse », geste
 * serviable en apparence, transformerait ce formulaire en registre des
 * adresses ayant un compte — interrogeable par n'importe qui, sans
 * authentification, et à volonté.
 */
export function ForgotPasswordForm() {
  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
    mode: "onSubmit",
  });

  const request = useMutation({ mutationFn: requestPasswordReset });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await request.mutateAsync(values);
    } catch (error) {
      applyApiErrorToForm(error, form.setError, { knownFields: ["email"] });
    }
  });

  if (request.isSuccess) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          Vérifiez votre messagerie
        </h1>
        <p className="text-sm text-muted-foreground">
          Si un compte est associé à cette adresse, un lien de réinitialisation
          vient d&apos;y être envoyé. Il expire dans 30 minutes.
        </p>
        <Link
          href={routes.login}
          className="inline-block text-sm text-brand underline-offset-4 hover:underline"
        >
          Retour à la connexion
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">
          Mot de passe oublié
        </h1>
        <p className="text-sm text-muted-foreground">
          Indiquez votre adresse : nous vous enverrons un lien de
          réinitialisation.
        </p>
      </header>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormMessage message={form.formState.errors.root?.message} />

        <FormField
          id="email"
          label="Adresse électronique"
          type="email"
          autoComplete="username"
          autoFocus
          error={form.formState.errors.email}
          {...form.register("email")}
        />

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? "Envoi…" : "Envoyer le lien"}
        </Button>

        <Link
          href={routes.login}
          className="block text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Retour à la connexion
        </Link>
      </form>
    </div>
  );
}
