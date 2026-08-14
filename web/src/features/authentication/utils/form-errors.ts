import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

import { ApiError } from "@/lib/api/api-error";

/**
 * Reporte une erreur d'API sur le formulaire qui l'a provoquée — EVT-040.
 *
 * Écrit une fois plutôt que recopié dans quatre `onSubmit` : la règle
 * intéressante — quel message atterrit où — doit avoir un seul endroit où être
 * corrigée.
 *
 * `error.errors[]` est ce qu'EVT-037 fait remonter du backend. Avant lui,
 * l'enveloppe RFC 9457 était lue puis jetée, et aucun champ ne pouvait être
 * marqué.
 */
export function applyApiErrorToForm<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  options: { readonly knownFields: readonly Path<T>[] },
): void {
  if (!(error instanceof ApiError)) {
    // Panne réseau, ou tout ce qui n'a pas atteint le serveur. Le message brut
    // d'une exception JavaScript n'apprend rien à l'utilisateur.
    setError("root", {
      message:
        "La connexion au serveur a échoué. Vérifiez votre accès au réseau.",
    });
    return;
  }

  const known = new Set<string>(options.knownFields);
  let placed = 0;

  for (const fieldError of error.errors) {
    /*
      Un champ que ce formulaire ne possède pas est ignoré ici et rattrapé plus
      bas par le message global. `setError` sur un nom inconnu de React Hook
      Form n'affiche rien : le message disparaîtrait en silence, et
      l'utilisateur verrait un formulaire refusé sans qu'aucun champ ne
      s'explique.
    */
    if (known.has(fieldError.field)) {
      setError(fieldError.field as Path<T>, { message: fieldError.message });
      placed += 1;
    }
  }

  if (placed === 0) {
    setError("root", { message: userMessageFor(error) });
  }
}

/**
 * Le message affiché quand aucun champ n'est en cause.
 *
 * 🔴 `AUTH_INVALID_CREDENTIALS` reste **générique**, et c'est délibéré. Le
 * backend traite déjà une adresse inconnue exactement comme un mot de passe
 * faux — même code, même délai — pour que cette route ne devienne pas un
 * registre des adresses ayant un compte. Préciser « cet utilisateur n'existe
 * pas » côté client, « pour aider », défait ce travail depuis l'écran.
 *
 * Il n'y a volontairement **aucun** cas pour un compte verrouillé :
 * `AUTH_ACCOUNT_LOCKED` est absent du catalogue backend par décision explicite.
 * Un compte verrouillé reçoit `AUTH_INVALID_CREDENTIALS`, comme tout échec de
 * connexion — sans quoi la réponse confirmerait l'existence du compte à celui
 * qui vient précisément de le faire verrouiller.
 */
export function userMessageFor(error: ApiError): string {
  switch (error.code) {
    case "AUTH_INVALID_CREDENTIALS":
      return "Adresse électronique ou mot de passe incorrect.";

    case "RATE_LIMIT_EXCEEDED":
      return retryAfterMessage(error);

    default:
      /*
        `detail` est rédigé pour un humain et vient du catalogue d'erreurs du
        backend, donc déjà filtré de ce qu'un appelant n'a pas à savoir. Le
        repli sur `title` couvre les codes sans détail.
      */
      return error.detail.length > 0 ? error.detail : error.title;
  }
}

/**
 * Le message de limitation de débit, avec le délai quand il est connu.
 *
 * `Retry-After` arrive par l'**en-tête HTTP**, que le client relève dans
 * `ApiError`. « Réessayez dans 47 secondes » est actionnable ; « trop de
 * requêtes » ne l'est pas, et pousse à réessayer immédiatement — ce qui
 * prolonge le blocage au lieu de l'écouler.
 */
function retryAfterMessage(error: ApiError): string {
  const seconds = error.retryAfterSeconds;

  if (seconds === undefined) {
    return "Trop de tentatives. Patientez quelques instants avant de réessayer.";
  }

  if (seconds < 60) {
    return `Trop de tentatives. Réessayez dans ${Math.ceil(seconds)} secondes.`;
  }

  const minutes = Math.ceil(seconds / 60);

  return `Trop de tentatives. Réessayez dans ${minutes} minute${minutes > 1 ? "s" : ""}.`;
}
