"use client";

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
            `MotionProvider` est le plus interne : il ne fournit qu'une
            configuration de rendu, et rien au-dessus n'en dépend. Le placer
            plus haut n'apporterait rien et éloignerait la configuration de
            l'arbre qu'elle régit.
          */}
          <MotionProvider>{children}</MotionProvider>
        </QueryProvider>
      </ThemeProvider>
    </InternationalizationProvider>
  );
}
