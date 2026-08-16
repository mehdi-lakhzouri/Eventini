import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { AppProviders } from "@/providers/app-providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Eventini",
  description: "Eventini web application",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
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
          AppProviders was written correctly and imported by nothing, so the
          QueryClient, theme and i18n contexts never existed at runtime. The
          first component to call useQuery would have thrown
          "No QueryClient set, use QueryClientProvider to set one".

          It stays a client boundary of its own: this layout remains a Server
          Component, and only the provider subtree ships to the browser.
        */}
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
