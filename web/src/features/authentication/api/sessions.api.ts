import { apiClient } from "@/lib/api/api-client";
import type { UserSession } from "../types";

/**
 * Les routes de gestion de session.
 *
 * 🔴 Les trois chemins précédents — `/identity/sessions*` — n'existaient pas,
 * et `revokeAllSessions` employait `POST .../revoke-all`, un verbe dans l'URL
 * que [ADR-0010] proscrit. Le backend expose `@Controller('auth/sessions')` :
 * révoquer, c'est **supprimer** une sous-ressource.
 */

/** `GET /auth/sessions` — les sessions actives du porteur. */
export function listSessions() {
  return apiClient.get<UserSession[]>("/auth/sessions");
}

/**
 * `DELETE /auth/sessions/{sessionId}` — révocation ciblée.
 *
 * L'identifiant est encodé : il vient d'une réponse du serveur, mais le
 * concaténer brut dans un chemin est l'habitude qui finit par insérer une
 * valeur contrôlée par l'utilisateur ailleurs.
 */
export function revokeSession(sessionId: string) {
  return apiClient.delete<void>(
    `/auth/sessions/${encodeURIComponent(sessionId)}`,
  );
}

/** `DELETE /auth/sessions` — révoque toutes les sessions, la courante incluse. */
export function revokeAllSessions() {
  return apiClient.delete<void>("/auth/sessions");
}
