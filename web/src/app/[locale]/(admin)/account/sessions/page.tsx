import type { Metadata } from "next";

import { SessionList } from "@/features/authentication";

export const metadata: Metadata = { title: "Sessions — Eventini" };

export default function SessionsPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">
          Sessions actives
        </h1>
        <p className="text-sm text-muted-foreground">
          Les appareils actuellement connectés à votre compte. Révoquez ceux que
          vous ne reconnaissez pas.
        </p>
      </header>

      <SessionList />
    </div>
  );
}
