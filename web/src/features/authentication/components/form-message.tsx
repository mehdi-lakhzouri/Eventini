"use client";

import { AlertTriangle } from "lucide-react";

/**
 * Le message d'erreur global d'un formulaire.
 *
 * `role="alert"` : l'échec survient après une soumission, donc l'utilisateur a
 * quitté le champ et ne relira pas spontanément le haut du formulaire. Sans
 * région live, un lecteur d'écran n'annoncerait rien du tout et la soumission
 * paraîtrait sans effet.
 *
 * `assertive` plutôt que `polite` : le message interrompt à raison, puisqu'il
 * explique pourquoi l'action demandée n'a pas eu lieu.
 */
export function FormMessage({ message }: { message?: string }) {
  if (message === undefined || message.length === 0) {
    return null;
  }

  return (
    <p
      role="alert"
      aria-live="assertive"
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}
