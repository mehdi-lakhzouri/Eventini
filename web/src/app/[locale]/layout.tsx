import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import {
  getMessages,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";
import { notFound } from "next/navigation";
import "../globals.css";
import { cn } from "@/lib/utils";
import { routing } from "@/i18n/routing";
import { AppProviders } from "@/providers/app-providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Les deux locales sont prérendues — EVT-047.
 *
 * Sans cela, tout `app/` devient dynamique : le segment `[locale]` est un
 * paramètre, et Next ne peut pas deviner ses valeurs. Le build cesserait de
 * produire les pages statiques qu'il produit aujourd'hui.
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Le titre et la description viennent du catalogue.
 *
 * `generateMetadata` plutôt qu'un objet `metadata` constant : la locale n'est
 * connue qu'à la requête, et un objet figé rendrait un titre français à un
 * lecteur anglophone jusque dans l'onglet du navigateur.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "application" });

  return { title: t("name"), description: t("description") };
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;

  /*
    🔴 `[locale]` attrape tout ce que le proxy n'a pas résolu, y compris
    `/unknown.txt`. Sans cette garde, une locale inventée rendrait la mise en
    page avec le catalogue de repli — donc une page apparemment valide sous une
    adresse qui n'existe pas, indexable et partageable.
  */
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  /*
    🔴 Sans cet appel, **toutes** les routes basculent en rendu dynamique.

    `getMessages` et `getTranslations` lisent la locale depuis les en-têtes de
    la requête quand personne ne la leur a donnée, et toucher aux en-têtes
    suffit à désactiver le rendu statique. Constaté au build : les 16 routes
    passaient de `○ (Static)` à `ƒ (Dynamic)` — sans erreur, sans avertissement,
    juste une ligne de moins dans le tableau de sortie.

    `setRequestLocale` fournit la locale depuis le segment `[locale]`, que
    `generateStaticParams` énumère déjà. Les en-têtes ne sont plus consultés et
    le prérendu redevient possible.
  */
  setRequestLocale(locale);

  const messages = await getMessages();

  return (
    <html
      /*
        L'attribut `lang` suit la locale. Il n'est pas décoratif : c'est lui
        qu'un lecteur d'écran utilise pour choisir sa voix et sa prononciation,
        et le laisser à `fr` sur une page anglaise la fait lire avec l'accent
        français. WCAG 3.1.1.
      */
      lang={locale}
      suppressHydrationWarning
      className={cn(
        "h-full",
        "antialiased",
        "font-sans",
        geistSans.variable,
        geistMono.variable,
      )}
    >
      <body className="min-h-full flex flex-col">
        {/*
          `NextIntlClientProvider` est monté ici, au-dessus d'`AppProviders`, et
          reçoit les messages résolus côté serveur. `AppProviders` en montait un
          avec `messages={{}}` en attendant ce ticket ; le laisser en place
          écraserait le catalogue par un objet vide.

          Il reste un `Server Component` : seul le sous-arbre des providers part
          dans le navigateur.
        */}
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AppProviders>{children}</AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
