import type { Metadata } from "next";

import { OrganizationSettingsPanel } from "./settings-panel";

export const metadata: Metadata = { title: "Organisation — Eventini" };

/**
 * Les réglages de l'organisation — EVT-046.
 *
 * Server Component : la page ne fait que composer. `"use client"` reste aussi
 * bas que possible dans l'arbre (FRONTEND_ARCHITECTURE.md §3) — le poser ici
 * basculerait toute la branche côté client sans rien y gagner.
 */
export default function OrganizationPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Organisation</h1>
        <p className="text-sm text-muted-foreground">
          Le nom et l&apos;identifiant de votre organisation, et les limites de
          votre formule.
        </p>
      </header>

      <OrganizationSettingsPanel />
    </div>
  );
}
