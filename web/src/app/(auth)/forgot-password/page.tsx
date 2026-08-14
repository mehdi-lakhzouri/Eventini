import type { Metadata } from "next";
import { Suspense } from "react";

import { ForgotPasswordForm } from "@/features/authentication";

export const metadata: Metadata = { title: "Mot de passe oublié — Eventini" };

/**
 * `Suspense` est obligatoire, pas décoratif : le formulaire lit
 * `useSearchParams()`, et Next refuse de prérendre statiquement un composant
 * client qui le fait sans frontière de suspension. Sans elle, le build bascule
 * la page en rendu dynamique — silencieusement, pour toutes les autres avec.
 */
export default function Page() {
  return (
    <Suspense fallback={<div className="h-80" aria-hidden="true" />}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
