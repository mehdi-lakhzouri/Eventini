import { apiClient } from "@/lib/api/api-client";
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from "../types";

/**
 * Les routes de mot de passe, telles que le backend les expose.
 *
 * 🔴 Les chemins précédents — `/identity/passwords/reset-request` et
 * `/identity/passwords/reset` — n'existaient pas, et les noms de champs
 * divergeaient également (`resetToken`/`password` contre `token`/`newPassword`).
 * Les corps auraient donc été rejetés même si les chemins avaient répondu :
 * la validation backend refuse les propriétés non déclarées.
 *
 * Noms au pluriel et sous forme de ressources ([ADR-0010]) : demander une
 * réinitialisation **crée une demande**, réinitialiser **crée** une
 * réinitialisation.
 */

/**
 * `POST /auth/password-reset-requests` — 202, toujours.
 *
 * La réponse est identique que l'adresse existe ou non. Répondre autrement
 * transformerait cette route en registre des adresses ayant un compte — et
 * elle n'est pas authentifiée.
 */
export function requestPasswordReset(input: ForgotPasswordInput) {
  return apiClient.post<{ accepted: true }>(
    "/auth/password-reset-requests",
    input,
  );
}

/** `POST /auth/password-resets` — 204. Le jeton est à usage unique, 30 minutes. */
export function resetPassword(input: ResetPasswordInput) {
  return apiClient.post<void>("/auth/password-resets", input);
}

/**
 * `PUT /auth/password` — 204. Changement par un utilisateur connecté.
 *
 * `currentPassword` est exigé même sur une session valide : sans lui, un poste
 * laissé déverrouillé suffirait à s'approprier le compte définitivement.
 */
export function changePassword(input: ChangePasswordInput) {
  return apiClient.put<void>("/auth/password", input);
}
