"use client";

import { NuqsAdapter } from "nuqs/adapters/next/app";
import type { ReactNode } from "react";
import { InternationalizationProvider } from "./internationalization-provider";
import { MotionProvider } from "./motion-provider";
import { QueryProvider } from "./query-provider";
import { ThemeProvider } from "./theme-provider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <InternationalizationProvider>
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
    </InternationalizationProvider>
  );
}
