"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { Link } from "@/i18n/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MailCheck,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { routes } from "@/config/routes";
import {
  forgotCardIn,
  forgotContentItem,
  forgotContentList,
  forgotErrorShake,
  forgotKeyIn,
  forgotSuccessIn,
  subtleButtonInteraction,
  useReducedMotion,
} from "@/lib/motion";
import { requestPasswordReset } from "../api/password.api";
import {
  buildForgotPasswordSchema,
  type ForgotPasswordFormValues,
} from "../schemas/password.schema";
import { applyApiErrorToForm } from "../utils/form-errors";
import { EventiniLogo } from "./eventini-logo";
import { FormMessage } from "./form-message";

/**
 * La demande de réinitialisation — EVT-040.
 *
 * 🔴 La confirmation est identique que l'adresse existe ou non. L'interface
 * ne doit jamais devenir un registre public des comptes Eventini.
 */
export function ForgotPasswordForm() {
  const t = useTranslations("authentication");
  const tv = useTranslations("validation");
  const schema = useMemo(() => buildForgotPasswordSchema(tv), [tv]);
  const reduceMotion = useReducedMotion();
  const initial = reduceMotion ? false : "hidden";

  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const request = useMutation({ mutationFn: requestPasswordReset });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await request.mutateAsync(values);
    } catch (error) {
      applyApiErrorToForm(error, form.setError, { knownFields: ["email"] });
    }
  });

  return (
    <motion.section
      aria-labelledby="forgot-password-title"
      initial={initial}
      animate="visible"
      variants={forgotCardIn}
      className="eventini-auth-card flex min-h-0 w-full items-center rounded-none border-0 bg-white px-6 py-7 shadow-none sm:min-h-[590px] sm:rounded-[22px] sm:border sm:border-[#e5e7eb] sm:px-10 sm:shadow-[0_12px_35px_rgba(15,23,42,0.09)]"
    >
      <AnimatePresence mode="wait" initial={false}>
        {request.isSuccess ? (
          <SuccessState key="success" reduceMotion={reduceMotion} />
        ) : (
          <motion.div
            key="form"
            className="w-full"
            initial={initial}
            animate="visible"
            exit="exit"
            variants={forgotContentList}
          >
            <motion.div variants={forgotContentItem} className="text-center">
              <EventiniLogo
                className="text-[#142aaf]"
                markClassName="size-9"
                wordmarkClassName="text-[1.65rem]"
              />
            </motion.div>

            <motion.div
              variants={forgotKeyIn}
              className="mx-auto mt-4 flex size-[60px] items-center justify-center rounded-full bg-[#eef0ff] text-[#2035b8]"
            >
              <KeyRound
                className="size-8"
                strokeWidth={1.7}
                aria-hidden="true"
              />
            </motion.div>

            <motion.h1
              id="forgot-password-title"
              variants={forgotContentItem}
              className="mt-3.5 text-center text-[2rem] font-bold leading-tight tracking-[-0.035em] text-[#0f172a]"
            >
              Mot de passe oublié
            </motion.h1>

            <motion.p
              variants={forgotContentItem}
              className="mx-auto mt-1.5 max-w-[410px] text-center text-[0.95rem] leading-[1.5] text-[#64748b]"
            >
              Indiquez votre adresse e-mail pour recevoir
              <br className="hidden sm:block" /> un lien de réinitialisation
              sécurisé.
            </motion.p>

            <form onSubmit={onSubmit} noValidate className="mt-5">
              <FormMessage message={form.formState.errors.root?.message} />

              <motion.div
                variants={forgotContentItem}
                animate={form.formState.errors.email ? "error" : "rest"}
              >
                <motion.div variants={forgotErrorShake} className="space-y-2">
                  <Label
                    htmlFor="forgot-email"
                    className="text-[0.94rem] font-semibold text-[#0f172a]"
                  >
                    {t("fields.email")}
                  </Label>
                  <div className="group relative">
                    <Mail
                      className={
                        form.formState.errors.email
                          ? "pointer-events-none absolute left-4 top-1/2 z-10 size-[1.35rem] -translate-y-1/2 text-destructive transition-colors duration-150"
                          : "pointer-events-none absolute left-4 top-1/2 z-10 size-[1.35rem] -translate-y-1/2 text-[#64748b] transition-colors duration-150 group-focus-within:text-[#222f90]"
                      }
                      strokeWidth={1.7}
                      aria-hidden="true"
                    />
                    <Input
                      id="forgot-email"
                      type="email"
                      autoComplete="email"
                      placeholder={t("fields.emailPlaceholder")}
                      className="h-[52px] rounded-[10px] border-[#d8dee9] bg-white pl-[52px] pr-5 text-[1rem] text-[#0f172a] shadow-none placeholder:text-[#64748b] focus-visible:border-[#222f90] focus-visible:ring-[#222f90]/10"
                      aria-invalid={form.formState.errors.email !== undefined}
                      aria-describedby={
                        form.formState.errors.email
                          ? "forgot-email-error"
                          : undefined
                      }
                      {...form.register("email")}
                    />
                  </div>
                  {form.formState.errors.email ? (
                    <p
                      id="forgot-email-error"
                      className="text-xs text-destructive"
                    >
                      {form.formState.errors.email.message}
                    </p>
                  ) : null}
                </motion.div>
              </motion.div>

              <motion.div variants={forgotContentItem} className="mt-4">
                <motion.div
                  initial="rest"
                  whileHover={reduceMotion ? undefined : "hover"}
                  whileTap={reduceMotion ? undefined : "pressed"}
                  variants={subtleButtonInteraction}
                >
                  <Button
                    type="submit"
                    size="lg"
                    className="h-[52px] w-full rounded-[10px] bg-[#222f90] text-[1.05rem] font-semibold text-white shadow-[0_7px_16px_rgba(34,47,144,0.14)] hover:bg-[#1b2675] disabled:cursor-wait disabled:opacity-100"
                    disabled={form.formState.isSubmitting}
                  >
                    {form.formState.isSubmitting ? (
                      <>
                        <LoaderCircle
                          className="size-5 animate-spin"
                          aria-hidden="true"
                        />
                        {t("forgotPassword.submitting")}
                      </>
                    ) : (
                      t("forgotPassword.submit")
                    )}
                  </Button>
                </motion.div>
              </motion.div>
            </form>

            <motion.div
              variants={forgotContentItem}
              className="mt-4 text-center"
            >
              <Link
                href={routes.login}
                className="inline-flex items-center gap-2 rounded-sm text-[1rem] font-medium text-[#1732ba] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-[#3148c7]"
              >
                <ArrowLeft
                  className="size-5"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
                Retour à la connexion
              </Link>
            </motion.div>

            <motion.div
              variants={forgotContentItem}
              className="mt-[18px] border-t border-[#e5e7eb] pt-[18px]"
            >
              <p className="flex items-center justify-center gap-2.5 text-[0.95rem] text-[#64748b]">
                <LockKeyhole
                  className="size-5"
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
                Lien de réinitialisation sécurisé
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

function SuccessState({ reduceMotion }: { reduceMotion: boolean | null }) {
  return (
    <motion.div
      className="w-full text-center"
      initial={reduceMotion ? false : "hidden"}
      animate="visible"
      variants={forgotSuccessIn}
    >
      <motion.div variants={forgotContentItem}>
        <EventiniLogo
          className="text-[#142aaf]"
          markClassName="size-9"
          wordmarkClassName="text-[1.65rem]"
        />
      </motion.div>
      <motion.div
        variants={forgotKeyIn}
        className="mx-auto mt-6 flex size-16 items-center justify-center rounded-full bg-[#eef0ff] text-[#2035b8]"
      >
        <MailCheck className="size-8" strokeWidth={1.7} aria-hidden="true" />
      </motion.div>
      <motion.h1
        id="forgot-password-title"
        variants={forgotContentItem}
        className="mt-5 text-[2rem] font-bold tracking-[-0.035em] text-[#0f172a]"
      >
        Vérifiez votre boîte mail
      </motion.h1>
      <motion.p
        variants={forgotContentItem}
        className="mx-auto mt-3 max-w-[420px] text-[0.95rem] leading-relaxed text-[#64748b]"
      >
        Si un compte correspond à cette adresse, un lien de réinitialisation
        vous a été envoyé.
      </motion.p>
      <motion.div variants={forgotContentItem} className="mt-6">
        <Link
          href={routes.login}
          className="inline-flex items-center gap-2 rounded-sm text-[1rem] font-medium text-[#1732ba] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-[#3148c7]"
        >
          <ArrowLeft className="size-5" strokeWidth={1.8} aria-hidden="true" />
          Retour à la connexion
        </Link>
      </motion.div>
      <motion.div
        variants={forgotContentItem}
        className="mt-7 border-t border-[#e5e7eb] pt-5"
      >
        <p className="flex items-center justify-center gap-2.5 text-[0.95rem] text-[#64748b]">
          <LockKeyhole
            className="size-5"
            strokeWidth={1.7}
            aria-hidden="true"
          />
          Lien de réinitialisation sécurisé
        </p>
      </motion.div>
    </motion.div>
  );
}
