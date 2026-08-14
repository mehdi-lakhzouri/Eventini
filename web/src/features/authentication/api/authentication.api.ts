import { apiClient } from "@/lib/api/api-client";
import type { CurrentUser, LoginInput, SessionCreated } from "../types";

/**
 * Les routes d'authentification, telles que le backend les expose réellement.
 *
 * 🔴 Les quatre chemins de la version précédente — `/identity/authentication/*`
 * — n'existaient pas. Vérifié le 14 août 2026 dans les contrôleurs :
 * `@Controller('auth/sessions')` et `@Controller('auth')`. Chaque appel aurait
 * répondu 404, et jamais 401 : un écran de connexion aurait paru rejeter des
 * identifiants corrects.
 *
 * Les noms sont des sous-ressources, pas des verbes ([ADR-0010]) : se connecter
 * **crée** une session, se déconnecter la **supprime**, rafraîchir crée une
 * rotation. Le préfixe `/api/v1` est porté par `NEXT_PUBLIC_API_BASE_URL`.
 */

/** `GET /auth/me` — le porteur de la session courante. */
export function getCurrentUser() {
  return apiClient.get<CurrentUser>("/auth/me");
}

/** `POST /auth/sessions` — connexion. */
export function login(input: LoginInput) {
  return apiClient.post<SessionCreated>("/auth/sessions", {
    ...input,
    // Le backend distingue WEB, MOBILE_SCANNER et PLATFORM : les durées de vie
    // de session en dépendent (ADR-0009).
    clientType: "WEB",
  });
}

/** `DELETE /auth/sessions/current` — déconnexion de la session courante. */
export function logout() {
  return apiClient.delete<void>("/auth/sessions/current");
}

/**
 * `POST /auth/sessions/current/rotation` — rotation des jetons.
 *
 * EVT-038 en fait le pivot du rattrapage sur 401. Cette route doit rester
 * **exclue** de ce rattrapage, sous peine de récursion infinie.
 */
export function refreshSession() {
  return apiClient.post<void>("/auth/sessions/current/rotation");
}
