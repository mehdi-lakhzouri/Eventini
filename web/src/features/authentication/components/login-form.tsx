"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { routes } from "@/config/routes";
import { ApiError } from "@/lib/api/api-error";
import { resetSessionRefreshState } from "@/lib/api/session-refresh";
import { useLogin } from "../hooks/use-login";
import { loginSchema, type LoginFormValues } from "../schemas/login.schema";
import { applyApiErrorToForm } from "../utils/form-errors";
import { FormMessage } from "./form-message";

/**
 * La connexion — EVT-040.
 *
 * `POST /auth/sessions` crée une session ; les jetons repartent en cookies
 * `HttpOnly` et rien d'exploitable ne transite par le corps (AUTH-INV-001).
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const login = useLogin();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
    // La validation ne se déclenche qu'après une première soumission. Marquer
    // une adresse « invalide » pendant qu'on la tape reproche une faute que
    // l'utilisateur n'a pas encore eu l'occasion de commettre.
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);

      /*
        Le verrou d'échec de rotation est levé : il survivrait sinon à la
        nouvelle session, et la première requête expirée refuserait une rotation
        pourtant légitime (EVT-038).
      */
      resetSessionRefreshState();

      router.replace(internalNext(searchParams) ?? routes.adminDashboard);
    } catch (error) {
      /*
        🔴 La MFA n'est pas un échec.

        Le backend répond 401 `AUTH_MFA_REQUIRED` en portant l'identifiant du
        défi dans les extensions. Aucun cookie n'est posé sur cette branche : un
        client qui ignorerait le 401 reste exactement aussi déconnecté qu'avant.
        Le mot de passe est vérifié, il reste le second facteur.
      */
      if (error instanceof ApiError && error.code === "AUTH_MFA_REQUIRED") {
        const challengeId = error.problem?.extensions.challengeId;

        if (challengeId !== undefined) {
          const target = new URLSearchParams({ challenge: challengeId });
          const destination = internalNext(searchParams);

          if (destination !== null) {
            target.set("next", destination);
          }

          router.push(`${routes.verifyMfa}?${target.toString()}`);
          return;
        }
      }

      applyApiErrorToForm(error, form.setError, {
        knownFields: ["email", "password"],
      });
    }
  });

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Bon retour</h1>
        <p className="text-sm text-muted-foreground">
          Connectez-vous pour accéder à votre organisation.
        </p>
      </header>

      {/* `noValidate` : la validation Zod affiche des messages en français et
          cohérents, là où les bulles natives du navigateur varient d'un moteur
          à l'autre et ne sont pas stylables. */}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormMessage message={form.formState.errors.root?.message} />

        <div className="space-y-1.5">
          <Label htmlFor="email">Adresse électronique</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
            aria-invalid={form.formState.errors.email !== undefined}
            aria-describedby={
              form.formState.errors.email ? "email-error" : undefined
            }
            {...form.register("email")}
          />
          {form.formState.errors.email ? (
            <p id="email-error" className="text-xs text-destructive">
              {form.formState.errors.email.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="password">Mot de passe</Label>
            <Link
              href={routes.forgotPassword}
              className="text-xs text-brand underline-offset-4 hover:underline"
            >
              Mot de passe oublié ?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={form.formState.errors.password !== undefined}
            aria-describedby={
              form.formState.errors.password ? "password-error" : undefined
            }
            {...form.register("password")}
          />
          {form.formState.errors.password ? (
            <p id="password-error" className="text-xs text-destructive">
              {form.formState.errors.password.message}
            </p>
          ) : null}
        </div>

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? "Connexion…" : "Se connecter"}
        </Button>
      </form>
    </div>
  );
}

/**
 * Le paramètre `next` posé par le proxy, **seulement** s'il désigne un chemin
 * interne.
 *
 * 🔴 Le test sur `//` n'est pas redondant avec celui sur `/` : `//evil.test/x`
 * commence bien par une barre oblique et reste une URL absolue à autorité,
 * qu'un navigateur suivrait vers un domaine tiers. Le filtrer est ce qui évite
 * une redirection ouverte au moment précis où l'utilisateur vient d'être
 * authentifié — l'instant le plus rentable pour un hameçonnage.
 */
export function internalNext(params: URLSearchParams): string | null {
  const value = params.get("next");

  return value !== null && value.startsWith("/") && !value.startsWith("//")
    ? value
    : null;
}
