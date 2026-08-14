/**
 * Locale configuration.
 *
 * Minimal on purpose. Full i18n — the `createNextIntlPlugin` wiring, the
 * `messages/*.json` catalogues, the `[locale]` routing strategy — is EVT-047 in
 * sprint 08. This module exists because `NextIntlClientProvider` requires a
 * `locale` and throws during prerendering without one, which is exactly what
 * mounting `AppProviders` uncovered.
 *
 * French is the default: the product is built for a francophone market and the
 * documentation corpus is French (ADR-0001).
 */
export const LOCALES = ["fr", "en"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "fr";

export function isSupportedLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}
