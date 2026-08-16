"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Eye,
  EyeOff,
  LockKeyhole,
  LogIn,
  LoaderCircle,
  Mail,
  UsersRound,
} from "lucide-react";
import { motion, useAnimate } from "motion/react";
import { useSearchParams } from "next/navigation";

import { Link, useRouter } from "@/i18n/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { routes } from "@/config/routes";
import { ApiError } from "@/lib/api/api-error";
import { resetSessionRefreshState } from "@/lib/api/session-refresh";
import { authCardIn, authSubmitMotion, useReducedMotion } from "@/lib/motion";
import { useLogin } from "../hooks/use-login";
import { loginSchema, type LoginFormValues } from "../schemas/login.schema";
import { applyApiErrorToForm } from "../utils/form-errors";
import { FormMessage } from "./form-message";
import { EventiniLogo } from "./eventini-logo";
import { TypewriterText } from "./typewriter-text";

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
  const reduceMotion = useReducedMotion();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submitButtonScope, animateSubmitButton] = useAnimate();

  function playSubmitFeedback() {
    if (reduceMotion) {
      return;
    }

    void animateSubmitButton([
      [
        submitButtonScope.current,
        { scale: [1, 0.965, 1.018, 1] },
        authSubmitMotion.button,
      ],
      [
        ".login-button-icon",
        { x: [0, 6, 0], rotate: [0, -6, 0] },
        authSubmitMotion.icon,
      ],
      [
        ".login-button-shine",
        {
          x: ["-180%", "-180%", "360%", "360%"],
          opacity: [0, 0.72, 0.5, 0],
        },
        authSubmitMotion.shine,
      ],
      [
        ".login-button-halo",
        { scale: [0.45, 1.28], opacity: [0.34, 0] },
        authSubmitMotion.halo,
      ],
    ]);
  }

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
    <motion.section
      aria-labelledby="login-title"
      initial={reduceMotion ? false : "hidden"}
      animate="visible"
      variants={authCardIn}
      className="eventini-auth-card eventini-login-card min-h-0 w-full rounded-[22px] border border-[#e5e7eb] bg-white px-7 py-8 shadow-[0_12px_35px_rgba(15,23,42,0.09)] sm:min-h-[640px] sm:px-10"
    >
      <header className="text-center">
        <EventiniLogo
          className="text-[#142aaf]"
          markClassName="size-9"
          wordmarkClassName="text-[1.65rem]"
        />

        <div className="mx-auto mt-5 flex size-16 items-center justify-center rounded-full bg-[#eef0ff] text-[#2035b8]">
          <UsersRound
            className="size-8"
            strokeWidth={1.65}
            aria-hidden="true"
          />
        </div>

        <h1
          id="login-title"
          className="mt-3 text-[2.125rem] font-bold leading-tight tracking-[-0.035em] text-[#0f172a]"
        >
          Bon retour
        </h1>
        <p className="mt-1.5 min-h-6 text-[1rem] leading-6 text-[#475569]">
          <TypewriterText
            delay={0.62}
            lines={["Connectez-vous pour gérer vos événements."]}
          />
        </p>
      </header>

      {/* `noValidate` : la validation Zod affiche des messages en français et
          cohérents, là où les bulles natives du navigateur varient d'un moteur
          à l'autre et ne sont pas stylables. */}
      <form onSubmit={onSubmit} noValidate className="mt-7 space-y-5">
        <FormMessage message={form.formState.errors.root?.message} />

        <div className="space-y-2">
          <Label
            htmlFor="email"
            className="text-[0.94rem] font-semibold text-[#0f172a]"
          >
            Adresse électronique
          </Label>
          <div className="relative">
            <Mail
              className="pointer-events-none absolute left-4 top-1/2 z-10 size-[1.35rem] -translate-y-1/2 text-[#56627a]"
              strokeWidth={1.7}
              aria-hidden="true"
            />
            <Input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="nom@entreprise.com"
              className="h-14 rounded-[10px] border-[#d8dee9] bg-white pl-[52px] pr-5 text-[1rem] text-[#0f172a] shadow-none placeholder:text-[#64748b] focus-visible:border-[#3148c7] focus-visible:ring-[#3148c7]/15"
              aria-invalid={form.formState.errors.email !== undefined}
              aria-describedby={
                form.formState.errors.email ? "email-error" : undefined
              }
              {...form.register("email")}
            />
          </div>
          {form.formState.errors.email ? (
            <p id="email-error" className="text-xs text-destructive">
              {form.formState.errors.email.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label
              htmlFor="password"
              className="text-[0.94rem] font-semibold text-[#0f172a]"
            >
              Mot de passe
            </Label>
            <Link
              href={routes.forgotPassword}
              className="rounded-sm text-[0.94rem] font-medium text-[#1732ba] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-[#3148c7]"
            >
              Mot de passe oublié ?
            </Link>
          </div>
          <div className="relative">
            <LockKeyhole
              className="pointer-events-none absolute left-4 top-1/2 z-10 size-[1.35rem] -translate-y-1/2 text-[#56627a]"
              strokeWidth={1.7}
              aria-hidden="true"
            />
            <Input
              id="password"
              type={passwordVisible ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••••••"
              className="h-14 rounded-[10px] border-[#d8dee9] bg-white pl-[52px] pr-[54px] text-[1rem] tracking-[0.12em] text-[#0f172a] shadow-none placeholder:text-[#64748b] focus-visible:border-[#3148c7] focus-visible:ring-[#3148c7]/15"
              aria-invalid={form.formState.errors.password !== undefined}
              aria-describedby={
                form.formState.errors.password ? "password-error" : undefined
              }
              {...form.register("password")}
            />
            <button
              type="button"
              onClick={() => setPasswordVisible((visible) => !visible)}
              className="absolute right-4 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-[#56627a] transition-colors hover:bg-[#eef0ff] hover:text-[#2035b8] focus-visible:outline-2 focus-visible:outline-[#3148c7]"
              aria-label={
                passwordVisible ? "Masquer la saisie" : "Afficher la saisie"
              }
              aria-pressed={passwordVisible}
            >
              {passwordVisible ? (
                <EyeOff className="size-6" strokeWidth={1.7} />
              ) : (
                <Eye className="size-6" strokeWidth={1.7} />
              )}
            </button>
          </div>
          {form.formState.errors.password ? (
            <p id="password-error" className="text-xs text-destructive">
              {form.formState.errors.password.message}
            </p>
          ) : null}
        </div>

        <motion.div
          ref={submitButtonScope}
          className="login-submit-motion relative will-change-transform"
        >
          <Button
            type="submit"
            size="lg"
            onClick={playSubmitFeedback}
            className="relative isolate h-14 w-full overflow-hidden rounded-[10px] bg-[linear-gradient(135deg,#1735c4_0%,#1828a8_100%)] text-[1.08rem] font-semibold text-white shadow-[0_8px_18px_rgba(34,47,144,0.16)] hover:bg-[linear-gradient(135deg,#142fae_0%,#121f8d_100%)] disabled:cursor-wait disabled:opacity-100"
            disabled={form.formState.isSubmitting}
          >
            <motion.span
              aria-hidden="true"
              className="login-button-halo pointer-events-none absolute inset-0 rounded-[inherit] bg-white/28 opacity-0"
            />
            <motion.span
              aria-hidden="true"
              className="login-button-shine pointer-events-none absolute inset-y-[-35%] left-0 w-[34%] -skew-x-20 bg-linear-to-r from-transparent via-white/70 to-transparent opacity-0"
              style={{ x: "-180%" }}
            />
            <span className="relative z-10 inline-flex items-center gap-2.5">
              <motion.span
                aria-hidden="true"
                className="login-button-icon inline-flex will-change-transform"
              >
                {form.formState.isSubmitting ? (
                  <LoaderCircle
                    className="size-[1.25rem] animate-spin"
                    strokeWidth={2.1}
                  />
                ) : (
                  <LogIn className="size-[1.25rem]" strokeWidth={2.1} />
                )}
              </motion.span>
              <span>
                {form.formState.isSubmitting ? "Connexion…" : "Se connecter"}
              </span>
            </span>
          </Button>
        </motion.div>
      </form>

      <p className="mt-5 flex items-center justify-center gap-2.5 text-[0.95rem] text-[#64748b]">
        <LockKeyhole className="size-5" strokeWidth={1.7} aria-hidden="true" />
        Votre connexion est sécurisée.
      </p>
    </motion.section>
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
