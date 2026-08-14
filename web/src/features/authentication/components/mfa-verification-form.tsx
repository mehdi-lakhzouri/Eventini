"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { routes } from "@/config/routes";
import { resetSessionRefreshState } from "@/lib/api/session-refresh";
import { verifyMfaChallenge } from "../api/mfa.api";
import {
  mfaVerificationSchema,
  type MfaVerificationFormValues,
} from "../schemas/mfa.schema";
import { applyApiErrorToForm } from "../utils/form-errors";
import { FormField } from "./form-field";
import { FormMessage } from "./form-message";
import { internalNext } from "./login-form";

/**
 * Le second facteur — EVT-040.
 *
 * L'identifiant du défi vient de l'URL, où la connexion l'a posé après le 401
 * `AUTH_MFA_REQUIRED`. Le porter dans l'URL plutôt qu'en mémoire est délibéré :
 * un rechargement de page ne doit pas obliger à ressaisir le mot de passe. Il
 * n'autorise rien seul — il désigne un défi qui expire en cinq minutes et
 * n'ouvre de session qu'accompagné d'un code valide.
 */
export function MfaVerificationForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const challengeId = searchParams.get("challenge");

  const form = useForm<MfaVerificationFormValues>({
    resolver: zodResolver(mfaVerificationSchema),
    defaultValues: { code: "" },
    mode: "onSubmit",
  });

  const verify = useMutation({
    mutationFn: (values: MfaVerificationFormValues) =>
      verifyMfaChallenge(challengeId as string, values),
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await verify.mutateAsync(values);
      resetSessionRefreshState();
      router.replace(internalNext(searchParams) ?? routes.adminDashboard);
    } catch (error) {
      applyApiErrorToForm(error, form.setError, { knownFields: ["code"] });
    }
  });

  /*
    Sans défi, il n'y a rien à vérifier. Renvoyer vers la connexion plutôt que
    d'afficher un formulaire inopérant : arriver ici directement, par un
    signet ou un lien partagé, est le cas normal de cette branche.
  */
  if (challengeId === null) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          Vérification indisponible
        </h1>
        <p className="text-sm text-muted-foreground">
          Ce lien de vérification est incomplet ou a expiré. Reprenez la
          connexion depuis le début.
        </p>
        <Button size="lg" className="w-full" onClick={() => router.replace(routes.login)}>
          Retour à la connexion
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Vérification</h1>
        <p className="text-sm text-muted-foreground">
          Saisissez le code à six chiffres affiché par votre application
          d&apos;authentification.
        </p>
      </header>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormMessage message={form.formState.errors.root?.message} />

        <FormField
          id="code"
          label="Code de vérification"
          // `one-time-code` permet le remplissage depuis un SMS ou un
          // gestionnaire de mots de passe ; `inputMode` ouvre le pavé
          // numérique sur mobile, où six chiffres au clavier alphabétique
          // sont une gêne inutile.
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
          autoFocus
          error={form.formState.errors.code}
          {...form.register("code")}
        />

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? "Vérification…" : "Vérifier"}
        </Button>
      </form>
    </div>
  );
}
