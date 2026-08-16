"use client";

import { NuqsAdapter } from "nuqs/adapters/next/app";
import type { ReactNode } from "react";
import { MotionProvider } from "./motion-provider";
import { QueryProvider } from "./query-provider";
import { ThemeProvider } from "./theme-provider";

/**
 * 🔴 `InternationalizationProvider` a disparu d'ici — EVT-047.
 *
 * Il montait un `NextIntlClientProvider` avec `messages={{}}`, ce qui était le
 * bon intérim tant qu'aucun catalogue n'existait. Maintenant que
 * `app/[locale]/layout.tsx` en monte un avec les messages résolus côté
 * serveur, le garder ici l'**écraserait** : le fournisseur le plus interne
 * gagne, et tous les composants rendraient leurs clés brutes.
 *
 * Le symptôme aurait été une interface couverte de `login.title`, sans la
 * moindre erreur pour l'expliquer.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <QueryProvider>
        {/*
            `nuqs` était installé et inutilisé jusqu'à EVT-046. Son adaptateur
            est **obligatoire** : sans lui, tout `useQueryState` lève à
            l'exécution — « nuqs requires an adapter » — et non à la
            compilation, donc l'oubli ne se verrait qu'à l'ouverture de
            l'écran concerné.

            Monté ici plutôt que dans le seul layout qui en a besoin : les
            filtres en URL sont un mécanisme d'application, et les prochains
            écrans de liste le réclameront tous.
          */}
        <NuqsAdapter>
          {/*
              `MotionProvider` est le plus interne : il ne fournit qu'une
              configuration de rendu, et rien au-dessus n'en dépend. Le placer
              plus haut n'apporterait rien et éloignerait la configuration de
              l'arbre qu'elle régit.
            */}
          <MotionProvider>{children}</MotionProvider>
        </NuqsAdapter>
      </QueryProvider>
    </ThemeProvider>
  );
}
