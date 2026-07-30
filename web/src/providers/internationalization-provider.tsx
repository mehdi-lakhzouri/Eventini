"use client";

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";

export function InternationalizationProvider({
  children,
}: {
  children: ReactNode;
}) {
  return <NextIntlClientProvider messages={{}}>{children}</NextIntlClientProvider>;
}
