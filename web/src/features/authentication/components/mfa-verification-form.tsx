"use client";

import { useTranslations } from "next-intl";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useSearchParams } from "next/navigation";

import { Link, useRouter } from "@/i18n/navigation";
import { useMemo, useEffect, useRef, useState } from "react";
import { Controller, useForm, type UseFormReturn } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { routes } from "@/config/routes";
import { ApiError } from "@/lib/api/api-error";
import { resetSessionRefreshState } from "@/lib/api/session-refresh";
import {
  mfaCardIn,
  mfaContentItem,
  mfaContentList,
  mfaErrorShake,
  mfaShieldIn,
  mfaSuccessIn,
  subtleButtonInteraction,
  useReducedMotion,
} from "@/lib/motion";
import { verifyMfaChallenge } from "../api/mfa.api";
import {
  buildMfaRecoveryCodeSchema,
  buildMfaVerificationSchema,
  type MfaRecoveryCodeFormValues,
  type MfaVerificationFormValues,
} from "../schemas/mfa.schema";
import { applyApiErrorToForm } from "../utils/form-errors";
import { EventiniLogo } from "./eventini-logo";
import { FormMessage } from "./form-message";
import { MfaOtpField } from "./mfa-otp-field";
import { internalNext } from "./login-form";

type VerificationMode = "totp" | "recovery";

// Laisse le temps à la transition de sortie puis rend l'état de confirmation
// réellement perceptible avant de naviguer (sans donner l'impression d'un
// écran d'attente supplémentaire).
const SUCCESS_REDIRECT_DELAY_MS = 1_600;
const INVALID_CODE_CLEAR_DELAY_MS = 420;

/**
 * Le second facteur — EVT-040.
 *
 * Le navigateur ne détient qu'un identifiant de défi temporaire. La session
 * finale et son niveau MFA restent exclusivement émis par le backend après
 * validation d'un TOTP ou d'un code de secours.
 */
export function MfaVerificationForm() {
  const t = useTranslations("authentication.mfa");
  const tv = useTranslations("validation");
  const totpSchema = useMemo(() => buildMfaVerificationSchema(tv), [tv]);
  const recoverySchema = useMemo(() => buildMfaRecoveryCodeSchema(tv), [tv]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const challengeId = searchParams.get("challenge");
  const reduceMotion = useReducedMotion();
  const [mode, setMode] = useState<VerificationMode>("totp");
  const [invalidAttempt, setInvalidAttempt] = useState(0);
  const otpInputRef = useRef<HTMLInputElement>(null);

  const otpForm = useForm<MfaVerificationFormValues>({
    resolver: zodResolver(totpSchema),
    defaultValues: { code: "" },
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const recoveryForm = useForm<MfaRecoveryCodeFormValues>({
    resolver: zodResolver(recoverySchema),
    defaultValues: { code: "" },
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const verify = useMutation({
    mutationFn: (code: string) =>
      verifyMfaChallenge(challengeId as string, { code }),
    onSuccess: resetSessionRefreshState,
  });

  useEffect(() => {
    if (invalidAttempt === 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      otpForm.setValue("code", "");
      otpInputRef.current?.focus();
    }, INVALID_CODE_CLEAR_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [invalidAttempt, otpForm]);

  useEffect(() => {
    if (!verify.isSuccess) {
      return;
    }

    const destination = internalNext(searchParams) ?? routes.adminDashboard;
    const timer = window.setTimeout(
      () => router.replace(destination),
      SUCCESS_REDIRECT_DELAY_MS,
    );

    return () => window.clearTimeout(timer);
  }, [router, searchParams, verify.isSuccess]);

  if (challengeId === null) {
    return (
      <UnavailableChallenge
        reduceMotion={reduceMotion}
        onReturn={() => router.replace(routes.login)}
      />
    );
  }

  const submitOtp = otpForm.handleSubmit(async ({ code }) => {
    try {
      await verify.mutateAsync(code);
    } catch (error) {
      if (error instanceof ApiError && error.code === "AUTH_MFA_INVALID") {
        otpForm.setError("code", {
          message: t("invalidCode"),
        });

        setInvalidAttempt((attempt) => attempt + 1);
      } else {
        applyApiErrorToForm(error, otpForm.setError, {
          knownFields: ["code"],
        });
      }
    }
  });

  const submitRecovery = recoveryForm.handleSubmit(async ({ code }) => {
    try {
      await verify.mutateAsync(code);
    } catch (error) {
      if (error instanceof ApiError && error.code === "AUTH_MFA_INVALID") {
        recoveryForm.setError("code", {
          message: t("invalidRecovery"),
        });
        return;
      }

      applyApiErrorToForm(error, recoveryForm.setError, {
        knownFields: ["code"],
      });
    }
  });

  function changeMode(nextMode: VerificationMode) {
    if (verify.isPending) {
      return;
    }

    otpForm.reset();
    recoveryForm.reset();
    verify.reset();
    setMode(nextMode);
  }

  const initial = reduceMotion ? false : "hidden";

  return (
    <motion.section
      aria-labelledby="mfa-title"
      initial={initial}
      animate="visible"
      variants={mfaCardIn}
      className="eventini-auth-card eventini-mfa-card mx-auto flex min-h-[680px] w-full max-w-[560px] items-center rounded-none border-0 bg-white px-5 py-9 shadow-none sm:rounded-[22px] sm:border sm:border-[#e5e7eb] sm:px-11 sm:shadow-[0_12px_35px_rgba(15,23,42,0.09)]"
    >
      <AnimatePresence mode="wait" initial={false}>
        {verify.isSuccess ? (
          <MfaSuccess key="success" reduceMotion={reduceMotion} />
        ) : mode === "totp" ? (
          <TotpPanel
            key="totp"
            form={otpForm}
            inputRef={otpInputRef}
            isPending={verify.isPending}
            reduceMotion={reduceMotion}
            onSubmit={submitOtp}
            onUseRecovery={() => changeMode("recovery")}
          />
        ) : (
          <RecoveryPanel
            key="recovery"
            form={recoveryForm}
            isPending={verify.isPending}
            reduceMotion={reduceMotion}
            onSubmit={submitRecovery}
            onUseTotp={() => changeMode("totp")}
          />
        )}
      </AnimatePresence>
    </motion.section>
  );
}

type TotpPanelProps = {
  form: UseFormReturn<MfaVerificationFormValues>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  isPending: boolean;
  reduceMotion: boolean | null;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  onUseRecovery: () => void;
};

function TotpPanel({
  form,
  inputRef,
  isPending,
  reduceMotion,
  onSubmit,
  onUseRecovery,
}: TotpPanelProps) {
  const t = useTranslations("authentication.mfa");
  const code = form.watch("code");
  const error = form.formState.errors.code;
  const initial = reduceMotion ? false : "hidden";

  return (
    <motion.div
      className="w-full"
      initial={initial}
      animate="visible"
      exit="exit"
      variants={mfaContentList}
    >
      <MfaHeader title={t("title")} description={t("totpHint")} icon="shield" />

      <form onSubmit={onSubmit} noValidate className="mt-8">
        <FormMessage message={form.formState.errors.root?.message} />

        <motion.div
          variants={mfaContentItem}
          animate={error ? "error" : "rest"}
        >
          <motion.div variants={mfaErrorShake}>
            <Controller
              control={form.control}
              name="code"
              render={({ field }) => (
                <MfaOtpField
                  value={field.value}
                  onChange={(value) => {
                    if (error) {
                      form.clearErrors("code");
                    }
                    field.onChange(value);
                  }}
                  disabled={isPending}
                  invalid={error !== undefined}
                  describedBy={error ? "mfa-code-error" : undefined}
                  inputRef={inputRef}
                />
              )}
            />
          </motion.div>
          <div className="min-h-7 pt-2">
            {error ? (
              <p
                id="mfa-code-error"
                role="alert"
                className="text-center text-[0.82rem] text-[#dc2626]"
              >
                {error.message}
              </p>
            ) : null}
          </div>
        </motion.div>

        <motion.div variants={mfaContentItem} className="mt-2">
          <motion.div
            initial="rest"
            whileHover={reduceMotion ? undefined : "hover"}
            whileTap={reduceMotion ? undefined : "pressed"}
            variants={subtleButtonInteraction}
          >
            <Button
              type="submit"
              size="lg"
              className="h-14 w-full rounded-[10px] bg-[#222f90] text-[1.05rem] font-semibold text-white hover:bg-[#1b2578] disabled:cursor-not-allowed disabled:bg-[#222f90] disabled:opacity-50"
              disabled={isPending || code.length !== 6}
            >
              {isPending ? (
                <>
                  <LoaderCircle
                    className="size-5 animate-spin"
                    aria-hidden="true"
                  />
                  {t("verifying")}
                </>
              ) : (
                t("verify")
              )}
            </Button>
          </motion.div>
        </motion.div>
      </form>

      <motion.div variants={mfaContentItem} className="mt-5 text-center">
        <button
          type="button"
          onClick={onUseRecovery}
          disabled={isPending}
          className="rounded-sm text-[0.94rem] font-medium text-[#1732ba] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-[#3148c7] disabled:pointer-events-none disabled:opacity-50"
        >
          Utiliser un code de secours
        </button>
      </motion.div>

      <AuthCardFooter />
    </motion.div>
  );
}

type RecoveryPanelProps = {
  form: UseFormReturn<MfaRecoveryCodeFormValues>;
  isPending: boolean;
  reduceMotion: boolean | null;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  onUseTotp: () => void;
};

function RecoveryPanel({
  form,
  isPending,
  reduceMotion,
  onSubmit,
  onUseTotp,
}: RecoveryPanelProps) {
  const t = useTranslations("authentication.mfa");
  const code = form.watch("code");
  const error = form.formState.errors.code;

  return (
    <motion.div
      className="w-full"
      initial={reduceMotion ? false : { opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
    >
      <MfaHeader
        title={t("recoveryLabel")}
        description={t("recoveryHint")}
        icon="key"
      />

      <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
        <FormMessage message={form.formState.errors.root?.message} />
        <div className="space-y-2.5">
          <Label htmlFor="recovery-code" className="sr-only">
            {t("recoveryLabel")}
          </Label>
          <div className="group relative">
            <KeyRound
              className={
                error
                  ? "pointer-events-none absolute left-5 top-1/2 z-10 size-5 -translate-y-1/2 text-destructive"
                  : "pointer-events-none absolute left-5 top-1/2 z-10 size-5 -translate-y-1/2 text-[#64748b] transition-colors group-focus-within:text-[#222f90]"
              }
              strokeWidth={1.7}
              aria-hidden="true"
            />
            <Input
              id="recovery-code"
              autoFocus
              autoComplete="one-time-code"
              placeholder={t("recoveryPlaceholder")}
              maxLength={16}
              disabled={isPending}
              className="h-14 rounded-[10px] border-[#d8dee9] bg-white pl-14 pr-4 font-mono text-[1rem] uppercase tracking-[0.12em] shadow-none placeholder:font-sans placeholder:tracking-normal focus-visible:border-[#222f90] focus-visible:ring-[#222f90]/10"
              aria-invalid={error !== undefined}
              aria-describedby={error ? "recovery-code-error" : undefined}
              {...form.register("code")}
            />
          </div>
          {error ? (
            <p
              id="recovery-code-error"
              role="alert"
              className="text-xs text-destructive"
            >
              {error.message}
            </p>
          ) : null}
        </div>

        <motion.div
          initial="rest"
          whileHover={reduceMotion ? undefined : "hover"}
          whileTap={reduceMotion ? undefined : "pressed"}
          variants={subtleButtonInteraction}
        >
          <Button
            type="submit"
            size="lg"
            className="h-14 w-full rounded-[10px] bg-[#222f90] font-semibold text-white hover:bg-[#1b2578] disabled:bg-[#222f90] disabled:opacity-50"
            disabled={isPending || code.trim().length === 0}
          >
            {isPending ? (
              <>
                <LoaderCircle
                  className="size-5 animate-spin"
                  aria-hidden="true"
                />
                {t("verifying")}
              </>
            ) : (
              t("verifyRecovery")
            )}
          </Button>
        </motion.div>
      </form>

      <div className="mt-5 text-center">
        <button
          type="button"
          onClick={onUseTotp}
          disabled={isPending}
          className="rounded-sm text-[0.94rem] font-medium text-[#1732ba] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-[#3148c7] disabled:pointer-events-none disabled:opacity-50"
        >
          Retour au code d’authentification
        </button>
      </div>

      <AuthCardFooter />
    </motion.div>
  );
}

function MfaHeader({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: "shield" | "key";
}) {
  return (
    <>
      <motion.div variants={mfaContentItem} className="text-center">
        <EventiniLogo
          className="text-[#142aaf]"
          markClassName="size-9"
          wordmarkClassName="text-[1.7rem]"
        />
      </motion.div>
      <motion.div
        variants={mfaShieldIn}
        className="mx-auto mt-6 flex size-16 items-center justify-center rounded-full bg-[#eef0ff] text-[#2035b8]"
      >
        {icon === "shield" ? (
          <ShieldCheck
            className="size-8"
            strokeWidth={1.7}
            aria-hidden="true"
          />
        ) : (
          <KeyRound className="size-8" strokeWidth={1.7} aria-hidden="true" />
        )}
      </motion.div>
      <motion.h1
        id="mfa-title"
        variants={mfaContentItem}
        className="mt-5 text-center text-[2rem] font-bold tracking-[-0.035em] text-[#0f172a]"
      >
        {title}
      </motion.h1>
      <motion.p
        variants={mfaContentItem}
        className="mx-auto mt-2 max-w-[390px] text-center text-[0.95rem] leading-relaxed text-[#64748b]"
      >
        {description}
      </motion.p>
    </>
  );
}

function AuthCardFooter() {
  return (
    <>
      <motion.div variants={mfaContentItem} className="mt-5 text-center">
        <Link
          href={routes.login}
          className="inline-flex items-center gap-2 rounded-sm text-[0.94rem] text-[#64748b] underline-offset-4 hover:text-[#1732ba] hover:underline focus-visible:outline-2 focus-visible:outline-[#3148c7]"
        >
          <ArrowLeft className="size-4" strokeWidth={1.8} aria-hidden="true" />
          Retour à la connexion
        </Link>
      </motion.div>
      <motion.div
        variants={mfaContentItem}
        className="mt-6 border-t border-[#e5e7eb] pt-6"
      >
        <p className="flex items-center justify-center gap-2 text-[0.86rem] text-[#64748b]">
          <LockKeyhole
            className="size-4"
            strokeWidth={1.7}
            aria-hidden="true"
          />
          Votre connexion est sécurisée.
        </p>
      </motion.div>
    </>
  );
}

function MfaSuccess({ reduceMotion }: { reduceMotion: boolean | null }) {
  return (
    <motion.div
      className="w-full text-center"
      initial={reduceMotion ? false : "hidden"}
      animate="visible"
      variants={mfaSuccessIn}
    >
      <motion.div variants={mfaContentItem}>
        <EventiniLogo
          className="text-[#142aaf]"
          markClassName="size-9"
          wordmarkClassName="text-[1.7rem]"
        />
      </motion.div>
      <motion.div
        variants={mfaShieldIn}
        className="mx-auto mt-10 flex size-20 items-center justify-center rounded-full bg-[#eaf8ef] text-[#16a34a]"
      >
        <Check className="size-11" strokeWidth={1.8} aria-hidden="true" />
      </motion.div>
      <motion.h1
        id="mfa-title"
        variants={mfaContentItem}
        className="mt-7 text-[2rem] font-bold tracking-[-0.035em] text-[#0f172a]"
      >
        Vérification réussie
      </motion.h1>
      <motion.p variants={mfaContentItem} className="mt-3 text-[#64748b]">
        Votre identité a été confirmée.
      </motion.p>
      <motion.div
        variants={mfaContentItem}
        className="mx-auto mt-9 flex max-w-sm items-center justify-center gap-2 rounded-[10px] bg-[#edf8f1] px-4 py-3 text-sm font-medium text-[#15803d]"
        role="status"
      >
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        Redirection vers votre espace Eventini…
      </motion.div>
    </motion.div>
  );
}

function UnavailableChallenge({
  reduceMotion,
  onReturn,
}: {
  reduceMotion: boolean | null;
  onReturn: () => void;
}) {
  return (
    <motion.section
      aria-labelledby="mfa-unavailable-title"
      initial={reduceMotion ? false : "hidden"}
      animate="visible"
      variants={mfaCardIn}
      className="eventini-auth-card eventini-mfa-card mx-auto flex min-h-[520px] w-full max-w-[560px] items-center rounded-none bg-white px-6 text-center shadow-none sm:rounded-[22px] sm:border sm:border-[#e5e7eb] sm:px-11 sm:shadow-[0_12px_35px_rgba(15,23,42,0.09)]"
    >
      <div className="w-full">
        <EventiniLogo
          className="text-[#142aaf]"
          markClassName="size-9"
          wordmarkClassName="text-[1.7rem]"
        />
        <div className="mx-auto mt-8 flex size-16 items-center justify-center rounded-full bg-[#eef0ff] text-[#2035b8]">
          <ShieldCheck
            className="size-8"
            strokeWidth={1.7}
            aria-hidden="true"
          />
        </div>
        <h1
          id="mfa-unavailable-title"
          className="mt-6 text-2xl font-bold text-[#0f172a]"
        >
          Vérification indisponible
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[#64748b]">
          Votre session de vérification est absente ou a expiré. Veuillez vous
          reconnecter.
        </p>
        <Button
          size="lg"
          className="mt-8 h-14 w-full rounded-[10px] bg-[#222f90] text-white hover:bg-[#1b2578]"
          onClick={onReturn}
        >
          Retour à la connexion
        </Button>
      </div>
    </motion.section>
  );
}
