import type { CurrentUser, Role } from "../types";

/**
 * Le rôle de l'appelant dans le contexte de sa session.
 *
 * `GET /auth/me` le renvoie depuis EVT-039, résolu côté serveur. Il ne
 * traverse **jamais** le jeton : un JWT est signé une fois et vit toute sa
 * durée, là où un rôle peut être révoqué à la seconde suivante (ADR-0004).
 *
 * Rappel utile au moment de s'en servir — le frontend n'est jamais une
 * frontière de sécurité (AUTH-INV-011). Ce test décide d'un affichage, pas
 * d'une autorisation.
 */
export function userHasRole(
  user: CurrentUser | null | undefined,
  role: Role,
): boolean {
  return user?.role === role;
}

/**
 * Vrai tant que la réponse n'est pas arrivée.
 *
 * Distinguer « je ne sais pas encore » de « non autorisé » est l'essentiel :
 * traiter le chargement comme un refus fait clignoter une redirection vers la
 * page d'erreur avant que la réponse n'arrive.
 */
export function isAuthorizationUnknown(
  user: CurrentUser | null | undefined,
): boolean {
  return user === null || user === undefined;
}
