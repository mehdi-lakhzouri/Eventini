"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/features/authentication";

/**
 * Résout l'organisation courante, et traite le cas où il n'y en a pas.
 *
 * ##  `organizationId` peut légitimement être `null`
 *
 * Deux cas, tous deux normaux (ADR-0002) : une session **plateforme** — un
 * `SUPER_ADMIN` hors de tout tenant — et un utilisateur membre de plusieurs
 * organisations qui n'en a pas encore activé une. Le client ne devine pas
 * laquelle : c'est `POST /organizations/{id}/activation` qui tranche.
 *
 * Sans ce garde, l'écran construirait `/organizations/null/members` et
 * récolterait un `404` qui ressemblerait à un bug de l'API. Mieux vaut dire ce
 * qui manque.
 */
export function OrganizationScope({
  children,
}: {
  children: (organizationId: string) => ReactNode;
}) {
  const t = useTranslations("organization");
  const { data, isPending, isError } = useCurrentUser();

  if (isPending) {
    return (
      <div className="space-y-3" aria-busy="true">
        <span className="sr-only">Chargement du contexte…</span>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Votre session n&apos;a pas pu être lue. Rechargez la page.
      </p>
    );
  }

  const organizationId = data?.organizationId ?? null;

  if (organizationId === null) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
        {t("noActiveOrganization")}
      </p>
    );
  }

  return <>{children(organizationId)}</>;
}
