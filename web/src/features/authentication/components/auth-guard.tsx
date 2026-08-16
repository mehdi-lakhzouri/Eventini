"use client";

import { useRouter } from "@/i18n/navigation";
import { useEffect, type ReactNode } from "react";

import { routes } from "@/config/routes";
import { hasPermission } from "@/lib/permissions/permission-checker";
import type { Permission } from "@/lib/permissions/permission.types";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "../hooks/use-current-user";
import type { Role } from "../types";

type AuthGuardProps = {
  children: ReactNode;
  requiredRole?: Role;
  requiredPermission?: Permission;
};

/**
 * Évite d'afficher une page qui échouerait de toute façon — EVT-039, corrige F-3.
 *
 * ##  Ce n'est pas une protection
 *
 * AUTH-INV-011 : le frontend n'est jamais une frontière de sécurité. Ce
 * composant décide d'un **affichage**. Contourner sa vérification depuis la
 * console ne donne accès à rien : la page rendue émettra des requêtes que la
 * chaîne de guards du backend refusera, et le rôle affiché ici est lui-même
 * une valeur consultative que le serveur ne relit jamais (ADR-0004).
 *
 * ## Le défaut corrigé
 *
 * La version précédente déclarait `requiredRole` dans son type de props et
 * destructurait **uniquement `{ children }`**. `(super-admin)/layout.tsx`
 * passait `requiredRole="SUPER_ADMIN"` : la valeur était silencieusement
 * jetée, et chaque page prétendument réservée s'affichait pour tout le monde.
 *
 * Le pendant de ce défaut est arrivé avec EVT-037 : le backend n'envoyait
 * alors ni rôle ni permission, si bien qu'appeler `userHasRole` aurait retourné
 * `false` en toutes circonstances et masqué chaque page à ses ayants droit.
 * Les deux moitiés se tiennent — d'où l'extension de `GET /auth/me` dans ce
 * même ticket.
 */
export function AuthGuard({
  children,
  requiredRole,
  requiredPermission,
}: AuthGuardProps) {
  const router = useRouter();
  const { data: user, isPending, isError } = useCurrentUser();

  const denied =
    user !== undefined &&
    ((requiredRole !== undefined && user.role !== requiredRole) ||
      (requiredPermission !== undefined &&
        !hasPermission(user.permissions as Permission[], requiredPermission)));

  useEffect(() => {
    if (isError) {
      router.replace(routes.login);
      return;
    }

    if (denied) {
      router.replace(routes.unauthorized);
    }
  }, [denied, isError, router]);

  /*
    Un squelette, jamais `null`.

    `null` produit un éclair de contenu vide suivi d'une redirection brutale :
    la page paraît cassée pendant le temps de la requête. Le squelette occupe
    la même place que le contenu à venir, donc rien ne saute quand il arrive.

    Il couvre aussi les états terminaux — erreur et refus — pendant que la
    redirection se joue : rendre `children` à cet instant afficherait une page
    interdite pendant une image.
  */
  if (isPending || isError || denied) {
    return (
      <div
        className="space-y-4 p-6"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <span className="sr-only">Vérification de votre session…</span>
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return <>{children}</>;
}
