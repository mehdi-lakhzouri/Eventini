"use client";

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";

import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";

/**
 * `locale` is required by next-intl v4. It was missing, and because
 * `AppProviders` was never mounted the omission stayed invisible — the build
 * only began failing once EVT-003 mounted it, with a prerender error on
 * `/account/profile`.
 *
 * `messages` still defaults to empty: there are no catalogues yet and no
 * component calls `useTranslations`. EVT-047 (sprint 08) adds the plugin, the
 * `messages/*.json` files and locale negotiation, at which point the locale
 * comes from the request instead of this default.
 */
export function InternationalizationProvider({
  children,
  locale = DEFAULT_LOCALE,
  messages = {},
}: {
  children: ReactNode;
  locale?: Locale;
  messages?: Record<string, unknown>;
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
