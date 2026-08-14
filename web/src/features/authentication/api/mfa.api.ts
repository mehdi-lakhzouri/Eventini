import { apiClient } from "@/lib/api/api-client";
import type { MfaVerificationInput, SessionCreated } from "../types";

/**
 * La vérification du défi MFA.
 *
 * 🔴 Le chemin précédent — `/identity/mfa/verify` — n'existait pas, et il
 * manquait surtout l'identifiant du défi. Le backend expose
 * `@Controller('auth/mfa/challenges')` avec le défi **dans le chemin** : la
 * vérification porte sur un défi précis, émis quelques secondes plus tôt, et
 * non sur « l'utilisateur en train de se connecter » — notion qui n'existe
 * pas côté serveur puisque aucune session n'est encore ouverte.
 *
 * L'identifiant provient de `extensions.challengeId` du 401 `AUTH_MFA_REQUIRED`
 * renvoyé par la connexion. C'est EVT-037 qui le fait remonter jusqu'ici.
 */
export function verifyMfaChallenge(
  challengeId: string,
  input: MfaVerificationInput,
) {
  return apiClient.post<SessionCreated>(
    `/auth/mfa/challenges/${encodeURIComponent(challengeId)}/verification`,
    input,
  );
}
