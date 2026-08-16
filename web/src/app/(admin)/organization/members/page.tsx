import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { MembersPanel } from "./members-panel";

export const metadata: Metadata = { title: "Membres — Eventini" };

/**
 * L'administration des membres — EVT-046.
 *
 * ## Le `Suspense` est obligatoire, pas décoratif
 *
 * La table lit ses filtres dans l'URL via `nuqs`, qui s'appuie sur
 * `useSearchParams`. En Next 16 ce hook **exige** une frontière `Suspense` au
 * dessus de lui : sans elle, le build bascule toute la page en rendu dynamique
 * et échoue au prérendu. C'est un défaut qui ne se voit pas en `next dev` et
 * casse `next build`, donc autant le poser d'emblée.
 */
export default function OrganizationMembersPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Membres</h1>
        <p className="text-sm text-muted-foreground">
          Invitez, suspendez ou retirez les personnes qui travaillent dans votre
          organisation.
        </p>
      </header>

      <Suspense
        fallback={
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        }
      >
        <MembersPanel />
      </Suspense>
    </div>
  );
}
