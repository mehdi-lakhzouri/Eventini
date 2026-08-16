import type { Metadata } from "next";

import { SecuritySettings } from "@/features/authentication";

export const metadata: Metadata = { title: "Sécurité — Eventini" };

export default function SecurityPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Sécurité</h1>
      <SecuritySettings />
    </div>
  );
}
