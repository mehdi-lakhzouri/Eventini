import { apiClient } from "@/lib/api/api-client";
import type {
  ActivatedSession,
  MembershipSummary,
  OrganizationProfile,
  VersionedOrganization,
} from "../types";

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

/**
 * `GET /organizations/{id}` — la fiche, **avec son `ETag`**.
 *
 * L'`ETag` est rendu à l'appelant plutôt que gardé ici : c'est le formulaire de
 * réglages qui le rejouera en `If-Match`, et le mémoriser dans ce module en
 * ferait un état global qu'une seconde lecture écraserait.
 */
export async function getOrganization(
  organizationId: string,
): Promise<VersionedOrganization> {
  const response = await apiClient.getEnvelope<OrganizationProfile>(
    `/organizations/${encodeURIComponent(organizationId)}`,
  );

  return {
    organization: response.data as OrganizationProfile,
    etag: response.etag,
  };
}

/**
 * `PATCH /organizations/{id}` — EVT-042 avec EVT-032.
 *
 * 🔴 `If-Match` est **obligatoire** côté backend : sans en-tête, la réponse est
 * `428`, pas un succès silencieux. C'est délibéré — deux administrateurs
 * éditant la même organisation s'écraseraient sinon sans que rien ne dise que
 * le travail du premier a existé.
 *
 * La réponse porte le **nouvel** `ETag`, réutilisé aussitôt : sans lui, un
 * second enregistrement d'affilée rejouerait la version périmée et récolterait
 * un `409` alors que personne d'autre n'a touché à la fiche.
 */
export async function updateOrganization(input: {
  organizationId: string;
  etag: string;
  changes: { name?: string; slug?: string };
}): Promise<VersionedOrganization> {
  const response = await apiClient.patchEnvelope<OrganizationProfile>(
    `/organizations/${encodeURIComponent(input.organizationId)}`,
    input.changes,
    { ifMatch: input.etag },
  );

  return {
    organization: response.data as OrganizationProfile,
    etag: response.etag,
  };
}
