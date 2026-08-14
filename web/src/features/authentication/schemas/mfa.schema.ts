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

export type MfaVerificationFormValues = z.infer<typeof mfaVerificationSchema>;
