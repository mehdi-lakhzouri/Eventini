import { apiClient } from "@/lib/api/api-client";
import type { Invitation } from "../types";

const base = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/invitations`;

/**
 * Ce que rend la création, et **seulement** la création.
 *
 * 🔴 `acceptanceToken` n'est renvoyé qu'ici, une fois. La base n'en garde que
 * l'empreinte HMAC (EVT-043), donc il est irrécupérable ensuite : ni `GET`, ni
 * un rechargement de la page ne le retrouveront. C'est un état de transition
 * tant qu'EVT-073 n'envoie pas les courriels.
 */
export type CreatedInvitation = Invitation & {
  acceptanceToken: string;
};

/** `POST /organizations/{id}/invitations` — `users.invite`. */
export function createInvitation(input: {
  organizationId: string;
  email: string;
  roleCode: string;
}) {
  return apiClient.post<CreatedInvitation>(base(input.organizationId), {
    email: input.email,
    roleCode: input.roleCode,
  });
}

/** `GET /organizations/{id}/invitations` — jamais de jeton dans la réponse. */
export function listInvitations(organizationId: string) {
  return apiClient.get<Invitation[]>(base(organizationId));
}

/** `DELETE /organizations/{id}/invitations/{invitationId}` — répond `204`. */
export function revokeInvitation(input: {
  organizationId: string;
  invitationId: string;
}) {
  return apiClient.delete<null>(
    `${base(input.organizationId)}/${encodeURIComponent(input.invitationId)}`,
  );
}
