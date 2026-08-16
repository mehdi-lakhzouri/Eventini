import { apiClient } from "@/lib/api/api-client";
import type {
  LifecycleResult,
  OrganizationMember,
  RoleChangeResult,
} from "../types";

const base = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/members`;

const member = (organizationId: string, membershipId: string) =>
  `${base(organizationId)}/${encodeURIComponent(membershipId)}`;

/** `GET /organizations/{id}/members` — `users.read`. */
export function listMembers(organizationId: string) {
  return apiClient.get<OrganizationMember[]>(base(organizationId));
}

/**
 * `PUT .../members/{membershipId}/roles` — `users.manage_roles`.
 *
 * `PUT` et non `PATCH` : le corps porte l'ensemble **voulu**, pas un delta.
 * Deux administrateurs envoyant chacun son delta produiraient une union que ni
 * l'un ni l'autre n'a demandée.
 */
export function replaceMemberRoles(input: {
  organizationId: string;
  membershipId: string;
  roleCodes: string[];
}) {
  return apiClient.put<RoleChangeResult>(
    `${member(input.organizationId, input.membershipId)}/roles`,
    { roleCodes: input.roleCodes },
  );
}

/**
 * `POST .../members/{membershipId}/suspension`.
 *
 * Une sous-ressource nommée plutôt qu'un `PATCH` du statut : la suspension est
 * une action avec ses propres effets, pas l'écriture d'un champ (ADR-0010).
 */
export function suspendMember(input: {
  organizationId: string;
  membershipId: string;
  reason: string | null;
}) {
  return apiClient.post<LifecycleResult>(
    `${member(input.organizationId, input.membershipId)}/suspension`,
    input.reason === null ? undefined : { reason: input.reason },
  );
}

/** `DELETE .../members/{membershipId}/suspension` — la réactivation. */
export function reactivateMember(input: {
  organizationId: string;
  membershipId: string;
}) {
  return apiClient.delete<LifecycleResult>(
    `${member(input.organizationId, input.membershipId)}/suspension`,
  );
}

/**
 * `DELETE .../members/{membershipId}` — la révocation.
 *
 * 🔴 La ligne n'est **pas** supprimée : elle passe à `REVOKED`, et la
 * révocation coupe en cascade les sessions et les assignations d'événement
 * (EVT-045). Le membre disparaît donc de la liste des actifs mais reste dans
 * l'historique, avec son auteur et sa raison.
 */
export function revokeMember(input: {
  organizationId: string;
  membershipId: string;
  reason: string | null;
}) {
  return apiClient.delete<LifecycleResult>(
    member(input.organizationId, input.membershipId),
    input.reason === null ? undefined : { body: { reason: input.reason } },
  );
}
