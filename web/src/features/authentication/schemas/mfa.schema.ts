import { z } from "zod";

import type { ValidationTranslator } from "./validation-translator";

/**
 * Un code TOTP : exactement six chiffres.
 *
 * `regex` plutôt que `length` seul, pour que « 12345a » soit refusé comme
 * malformé plutôt qu'envoyé au backend, où il consommerait l'une des cinq
 * tentatives du défi (ADR-0009). Une faute de frappe ne doit pas coûter un
 * essai.
 */
export function buildMfaVerificationSchema(t: ValidationTranslator) {
  return z.object({
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, t("codeSixDigits")),
  });
}

/**
 * Les codes imprimés contiennent dix caractères Crockford base32. Le backend
 * ignore casse, espaces et tirets ; le client accepte donc les mêmes variantes
 * de saisie sans modifier la valeur secrète conservée uniquement en mémoire.
 */
export function buildMfaRecoveryCodeSchema(t: ValidationTranslator) {
  return z.object({
    code: z
      .string()
      .trim()
      .refine(
        (value) => {
          const normalized = value.toUpperCase().replaceAll(/[\s-]/g, "");
          return /^[0-9A-HJKMNP-TV-Z]{10}$/.test(normalized);
        },
        { message: t("recoveryInvalid") },
      ),
  });
}

export type MfaVerificationFormValues = z.infer<
  ReturnType<typeof buildMfaVerificationSchema>
>;
export type MfaRecoveryCodeFormValues = z.infer<
  ReturnType<typeof buildMfaRecoveryCodeSchema>
>;
