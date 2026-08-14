import { z } from "zod";

/**
 * Les bornes sont celles du backend, vérifiées dans `password.policy` :
 * 12 minimum, 128 maximum.
 *
 * La borne haute n'est pas décorative : elle empêche un mégaoctet d'entrée
 * d'atteindre Argon2id, dont le coût est calibré pour une phrase de passe.
 *
 * ⚠️ Le décompte diffère légèrement du backend, qui compte les **graphèmes** :
 * douze ligatures ou émojis font vingt-quatre unités UTF-16 et passeraient ici
 * alors qu'ils sont refusés là-bas. L'écart est acceptable puisque cette
 * validation est consultative, et il va dans le bon sens — le client est plus
 * permissif, donc il n'invente jamais un refus que le backend n'aurait pas.
 */
const newPassword = z
  .string()
  .min(12, "Le mot de passe doit contenir au moins 12 caractères.")
  .max(128, "Le mot de passe ne peut pas dépasser 128 caractères.");

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .min(1, "L'adresse électronique est requise.")
    .email("Cette adresse électronique est invalide."),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    newPassword,
    confirmation: z.string().min(1, "Confirmez le mot de passe."),
  })
  /*
    La confirmation est purement cliente — le backend n'en reçoit pas et n'en
    veut pas. Elle protège contre une faute de frappe sur un mot de passe qu'on
    ne voit pas, dans un formulaire où l'on ne peut pas réessayer : le jeton de
    réinitialisation est à usage unique.
  */
  .refine((values) => values.newPassword === values.confirmation, {
    path: ["confirmation"],
    message: "Les deux mots de passe ne correspondent pas.",
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Le mot de passe actuel est requis."),
    newPassword,
    confirmation: z.string().min(1, "Confirmez le mot de passe."),
  })
  .refine((values) => values.newPassword === values.confirmation, {
    path: ["confirmation"],
    message: "Les deux mots de passe ne correspondent pas.",
  })
  .refine((values) => values.newPassword !== values.currentPassword, {
    path: ["newPassword"],
    message: "Le nouveau mot de passe doit être différent de l'actuel.",
  });

export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;
