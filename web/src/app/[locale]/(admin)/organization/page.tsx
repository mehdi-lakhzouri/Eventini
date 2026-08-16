import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { OrganizationSettingsPanel } from "./settings-panel";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "organization.settings",
  });

  return { title: `${t("title")} — Eventini` };
}

/**
 * Les réglages de l'organisation — EVT-046.
 *
 * Server Component : la page ne fait que composer. `"use client"` reste aussi
 * bas que possible dans l'arbre (FRONTEND_ARCHITECTURE.md §3) — le poser ici
 * basculerait toute la branche côté client sans rien y gagner.
 */
export default async function OrganizationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Sans cela, la page reste en rendu dynamique : voir la note du
  // layout de locale.
  setRequestLocale(locale);

  const t = await getTranslations("organization.settings");

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      <OrganizationSettingsPanel />
    </div>
  );
}
