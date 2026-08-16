"use client";

import {
  OrganizationProfileForm,
  OrganizationScope,
} from "@/features/organizations";

/**
 * Le corps de l'écran de réglages — EVT-046.
 *
 * ## 🔴 Pourquoi ce fichier existe plutôt qu'un `OrganizationScope` dans la page
 *
 * `OrganizationScope` prend une **fonction** en enfant, pour passer
 * l'`organizationId` qu'il résout. Une fonction ne traverse pas la frontière
 * RSC : appelé directement depuis `page.tsx`, qui est un Server Component, le
 * build échoue au prérendu avec *« Functions cannot be passed directly to
 * Client Components »*.
 *
 * Le contournement n'est pas de basculer la page en `"use client"` — cela
 * remonterait la frontière et emporterait tout le sous-arbre. C'est d'ouvrir la
 * frontière ici, sous la page, et de garder le rendu par fonction **entre
 * composants client**, où il est parfaitement légal. Même motif que
 * `members-panel.tsx`.
 */
export function OrganizationSettingsPanel() {
  return (
    <OrganizationScope>
      {(organizationId) => (
        <OrganizationProfileForm organizationId={organizationId} />
      )}
    </OrganizationScope>
  );
}
