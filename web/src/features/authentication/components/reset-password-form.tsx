"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useSearchParams } from "next/navigation";

import { useRouter } from "@/i18n/navigation";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { routes } from "@/config/routes";
import { resetPassword } from "../api/password.api";
import {
  buildResetPasswordSchema,
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
  const t = useTranslations("authentication");
  const tv = useTranslations("validation");
  const schema = useMemo(() => buildResetPasswordSchema(tv), [tv]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(schema),
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
          {t("resetPassword.incompleteLink")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("resetPassword.incompleteLinkDetail")}
        </p>
        <Button
          size="lg"
          className="w-full"
          onClick={() => router.replace(routes.forgotPassword)}
        >
          {t("resetPassword.requestNewLink")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("resetPassword.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("resetPassword.subtitle")}
        </p>
      </header>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormMessage message={form.formState.errors.root?.message} />

        <FormField
          id="newPassword"
          label={t("fields.newPassword")}
          type="password"
          autoComplete="new-password"
          autoFocus
          hint={t("fields.passwordHint")}
          error={form.formState.errors.newPassword}
          {...form.register("newPassword")}
        />

        <FormField
          id="confirmation"
          label={t("fields.confirmation")}
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
          {form.formState.isSubmitting
            ? t("resetPassword.submitting")
            : t("resetPassword.submit")}
        </Button>
      </form>
    </div>
  );
}
