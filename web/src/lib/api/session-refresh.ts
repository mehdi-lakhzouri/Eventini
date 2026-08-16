import { environment } from "@/config/environment";
import { withCsrfHeader } from "./csrf-client";

/**
 * La rotation des jetons, dédupliquée — EVT-038, `FRONTEND_ARCHITECTURE.md` §4.2.
 *
 * ## 🔴 Pourquoi la déduplication n'est pas une optimisation
 *
 * Un tableau de bord monte dix requêtes en parallèle. Le jeton d'accès vient
 * d'expirer : les dix reçoivent `401`.
 *
 * Sans déduplication, les dix déclenchent une rotation **avec le même refresh
 * token**. La première le consomme ; les neuf suivantes présentent un jeton
 * désormais `CONSUMED`. Le backend applique alors exactement ce qu'on lui a
 * demandé de faire — détection de rejeu, session `COMPROMISED`, famille entière
 * révoquée (AUTH-INV-003).
 *
 * L'utilisateur est déconnecté par une mesure anti-vol de jeton, alors que rien
 * n'a été volé. Le mécanisme de sécurité du backend se retourne contre
 * l'utilisateur légitime, et le symptôme — « je suis déconnecté au hasard » —
 * ne désigne rien de ce qui l'a causé.
 *
 * ## Pourquoi un `fetch` nu plutôt que `apiClient`
 *
 * Passer par `apiClient` mettrait la rotation sur le chemin qui rattrape les
 * `401` : une rotation qui échoue en `401` déclencherait une rotation, et ainsi
 * de suite. L'exclusion est ici **structurelle** plutôt que déclarative — il
 * n'y a pas de liste de chemins à tenir à jour, donc rien à oublier.
 */

const ROTATION_PATH = "/auth/sessions/current/rotation";

/** La rotation en vol, s'il y en a une. C'est tout le mécanisme. */
let inFlight: Promise<boolean> | null = null;

/**
 * Vrai quand une rotation a échoué et qu'aucune connexion n'a eu lieu depuis.
 *
 * Sans ce verrou, chaque requête d'une page qui en émet dix relancerait sa
 * propre rotation après l'échec de la précédente : dix appels voués à échouer,
 * dix événements de sécurité côté backend, et une redirection qui se bat contre
 * les requêtes encore en vol.
 */
let sessionLost = false;

type SessionLostHandler = () => void;

let onSessionLost: SessionLostHandler | null = null;

/**
 * Branche la réaction à une session définitivement perdue.
 *
 * L'inversion est nécessaire : purger le cache réclame le `QueryClient`, qui
 * naît dans un provider, et rediriger réclame le routeur. `lib/api` ne peut
 * importer ni l'un ni l'autre — `MODULE_DEPENDENCY_MAP.md` §7 interdit à `lib/`
 * de dépendre d'une feature, et une dépendance vers React rendrait ce module
 * intestable hors composant.
 */
export function setSessionLostHandler(
  handler: SessionLostHandler | null,
): void {
  onSessionLost = handler;
}

/**
 * À appeler après une connexion réussie.
 *
 * Le verrou survivrait sinon à la nouvelle session : l'utilisateur se
 * reconnecterait, et la première requête expirée refuserait de tenter une
 * rotation pourtant légitime.
 */
export function resetSessionRefreshState(): void {
  inFlight = null;
  sessionLost = false;
}

/** Pour les tests : l'état de module, sans passer par le réseau. */
export function isRotationInFlight(): boolean {
  return inFlight !== null;
}

async function rotate(): Promise<boolean> {
  const response = await fetch(`${environment.apiBaseUrl}${ROTATION_PATH}`, {
    method: "POST",
    // Le refresh token vit dans un cookie `HttpOnly` scopé au chemin de
    // rotation. Il n'est jamais lu depuis JavaScript (AUTH-INV-001) : le
    // navigateur seul décide de le joindre.
    credentials: "include",
    headers: withCsrfHeader(),
  }).catch(() => null);

  // `null` couvre la panne réseau. La distinguer d'un refus du serveur
  // n'apporterait rien ici : dans les deux cas la requête d'origine ne peut
  // pas être rejouée maintenant.
  return response !== null && response.ok;
}

/**
 * Fait tourner les jetons, ou attend la rotation déjà en cours.
 *
 * Dix appels concurrents produisent **un** appel réseau et une seule promesse
 * partagée. Le `finally` remet le module à zéro pour qu'une expiration
 * ultérieure puisse en déclencher une nouvelle — sans lui, la première rotation
 * serait la seule de toute la vie de l'onglet.
 */
export function refreshSessionOnce(): Promise<boolean> {
  if (sessionLost) {
    return Promise.resolve(false);
  }

  if (inFlight !== null) {
    return inFlight;
  }

  inFlight = rotate()
    .then((succeeded) => {
      if (!succeeded) {
        sessionLost = true;
        // Déclenché ici, à l'intérieur de la promesse partagée : les dix
        // requêtes en attente reçoivent le même résultat, mais la purge et la
        // redirection n'ont lieu qu'une fois.
        onSessionLost?.();
      }

      return succeeded;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
