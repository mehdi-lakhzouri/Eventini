"use client";

import type { ReactNode } from "react";
import { InternationalizationProvider } from "./internationalization-provider";
import { QueryProvider } from "./query-provider";
import { ThemeProvider } from "./theme-provider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <InternationalizationProvider>
      <ThemeProvider>
        <QueryProvider>{children}</QueryProvider>
      </ThemeProvider>
    </InternationalizationProvider>
  );
}
