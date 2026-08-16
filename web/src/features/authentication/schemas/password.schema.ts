import { z } from "zod";

import type { ValidationTranslator } from "./validation-translator";

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
const MIN_LENGTH = 12;
const MAX_LENGTH = 128;

const newPasswordField = (t: ValidationTranslator) =>
  z
    .string()
    .min(MIN_LENGTH, t("passwordTooShort", { min: MIN_LENGTH }))
    .max(MAX_LENGTH, t("passwordTooLong", { max: MAX_LENGTH }));

export function buildForgotPasswordSchema(t: ValidationTranslator) {
  return z.object({
    email: z.string().min(1, t("emailRequired")).email(t("emailInvalid")),
  });
}

export function buildResetPasswordSchema(t: ValidationTranslator) {
  return (
    z
      .object({
        token: z.string().min(1),
        newPassword: newPasswordField(t),
        confirmation: z.string().min(1, t("confirmRequired")),
      })
      /*
    La confirmation est purement cliente — le backend n'en reçoit pas et n'en
    veut pas. Elle protège contre une faute de frappe sur un mot de passe qu'on
    ne voit pas, dans un formulaire où l'on ne peut pas réessayer : le jeton de
    réinitialisation est à usage unique.
  */
      .refine((values) => values.newPassword === values.confirmation, {
        path: ["confirmation"],
        message: t("confirmationMismatch"),
      })
  );
}

export function buildChangePasswordSchema(t: ValidationTranslator) {
  return z
    .object({
      currentPassword: z.string().min(1, t("currentPasswordRequired")),
      newPassword: newPasswordField(t),
      confirmation: z.string().min(1, t("confirmRequired")),
    })
    .refine((values) => values.newPassword === values.confirmation, {
      path: ["confirmation"],
      message: t("confirmationMismatch"),
    })
    .refine((values) => values.newPassword !== values.currentPassword, {
      path: ["newPassword"],
      message: t("newPasswordSameAsCurrent"),
    });
}

export type ForgotPasswordFormValues = z.infer<
  ReturnType<typeof buildForgotPasswordSchema>
>;
export type ResetPasswordFormValues = z.infer<
  ReturnType<typeof buildResetPasswordSchema>
>;
export type ChangePasswordFormValues = z.infer<
  ReturnType<typeof buildChangePasswordSchema>
>;
