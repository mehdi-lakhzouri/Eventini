import { z } from "zod";

/**
 * Un code TOTP : exactement six chiffres.
 *
 * `regex` plutôt que `length` seul, pour que « 12345a » soit refusé comme
 * malformé plutôt qu'envoyé au backend, où il consommerait l'une des cinq
 * tentatives du défi (ADR-0009). Une faute de frappe ne doit pas coûter un
 * essai.
 */
export const mfaVerificationSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Le code doit contenir exactement six chiffres."),
});

/**
 * Les codes imprimés contiennent dix caractères Crockford base32. Le backend
 * ignore casse, espaces et tirets ; le client accepte donc les mêmes variantes
 * de saisie sans modifier la valeur secrète conservée uniquement en mémoire.
 */
export const mfaRecoveryCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .refine(
      (value) => {
        const normalized = value.toUpperCase().replaceAll(/[\s-]/g, "");
        return /^[0-9A-HJKMNP-TV-Z]{10}$/.test(normalized);
      },
      { message: "Saisissez un code de secours valide." },
    ),
});

export type MfaVerificationFormValues = z.infer<typeof mfaVerificationSchema>;
export type MfaRecoveryCodeFormValues = z.infer<typeof mfaRecoveryCodeSchema>;
