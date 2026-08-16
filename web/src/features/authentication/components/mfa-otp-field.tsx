"use client";

import { OTPInputContext, REGEXP_ONLY_DIGITS } from "input-otp";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useContext, type RefObject } from "react";

import { InputOTP } from "@/components/ui/input-otp";
import { duration, easing } from "@/lib/motion";
import { cn } from "@/lib/utils";

type MfaOtpFieldProps = {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  invalid: boolean;
  describedBy?: string;
  inputRef: RefObject<HTMLInputElement | null>;
};

/** Un seul champ OTP accessible, projeté visuellement dans six emplacements. */
export function MfaOtpField({
  value,
  onChange,
  disabled,
  invalid,
  describedBy,
  inputRef,
}: MfaOtpFieldProps) {
  const t = useTranslations("authentication.mfa");

  return (
    <InputOTP
      ref={inputRef}
      value={value}
      onChange={onChange}
      maxLength={6}
      pattern={REGEXP_ONLY_DIGITS}
      inputMode="numeric"
      autoComplete="one-time-code"
      autoFocus
      disabled={disabled}
      aria-label={t("codeLabel")}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      containerClassName="justify-center gap-1.5 sm:gap-2.5"
      className="disabled:cursor-not-allowed"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <MfaOtpSlot key={index} index={index} invalid={invalid} />
      ))}
    </InputOTP>
  );
}

function MfaOtpSlot({ index, invalid }: { index: number; invalid: boolean }) {
  const context = useContext(OTPInputContext);
  const { char, hasFakeCaret, isActive } = context?.slots[index] ?? {};
  const isFilled = char !== null && char !== undefined;

  return (
    <div
      data-slot="mfa-otp-slot"
      data-active={isActive}
      data-filled={isFilled}
      className={cn(
        "relative flex h-[58px] w-[clamp(38px,11vw,54px)] shrink-0 items-center justify-center rounded-[10px] border bg-white text-[1.3rem] font-semibold text-[#0f172a] transition-[transform,border-color,box-shadow,background-color] duration-150",
        "border-[#d8dee9] data-[filled=true]:border-[#222f90]/45 data-[active=true]:z-10 data-[active=true]:scale-[1.035] data-[active=true]:border-[#222f90] data-[active=true]:shadow-[0_0_0_3px_rgba(34,47,144,0.10)]",
        invalid &&
          "border-[#ef4444] bg-[#fef2f2] data-[active=true]:border-[#ef4444] data-[active=true]:shadow-[0_0_0_3px_rgba(239,68,68,0.10)] data-[filled=true]:border-[#ef4444]",
      )}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {isFilled ? (
          <motion.span
            key={`${index}-${char}`}
            initial={{ opacity: 0, scale: 0.82, y: 3 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: duration.instant, ease: easing.emphasized }}
          >
            {char}
          </motion.span>
        ) : null}
      </AnimatePresence>
      {hasFakeCaret ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="h-5 w-px animate-caret-blink bg-[#0f172a] duration-1000" />
        </span>
      ) : null}
    </div>
  );
}
