import { apiClient } from "@/lib/api/api-client";
import type { ActivatedSession, MembershipSummary } from "../types";

/** `GET /organizations` — les organisations de l'appelant, la courante marquée. */
export function listOrganizations() {
  return apiClient.get<MembershipSummary[]>("/organizations");
}

/**
 * `POST /organizations/{id}/activation` — bascule de contexte.
 *
 * Un POST sur une sous-ressource et non un PUT sur la session : l'activation
 * est une action aux effets bien plus larges que l'écriture d'un champ — elle
 * remplace la session et révoque une famille de jetons ([ADR-0010]).
 */
export function activateOrganization(organizationId: string) {
  return apiClient.post<ActivatedSession>(
    `/organizations/${encodeURIComponent(organizationId)}/activation`,
  );
}
