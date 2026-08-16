"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "@/i18n/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { setSessionLostHandler } from "@/lib/api/session-refresh";
import { createQueryClient } from "@/lib/query/query-client";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());
  const router = useRouter();

  /**
   * Ce qui se passe quand la rotation échoue définitivement — EVT-038.
   *
   * Branché ici parce que c'est le seul endroit qui tient à la fois le
   * `QueryClient` et le routeur. `lib/api` ne peut atteindre ni l'un ni
   * l'autre : `MODULE_DEPENDENCY_MAP.md` §7 lui interdit de dépendre d'une
   * feature, et une dépendance vers React le rendrait intestable hors
   * composant. D'où l'inversion — le coordinateur déclare l'événement, le
   * provider décide de la réaction.
   *
   * 🔴 `clear()` et non `invalidateQueries()`. Une invalidation **laisse les
   * données en place** et se contente de les marquer périmées : les réponses de
   * la session précédente resteraient affichées jusqu'à ce qu'une requête les
   * remplace. Sur un produit multi-tenant, c'est une fuite côté client — le
   * backend a fait son travail, c'est le cache du navigateur qui trahit. Même
   * règle après une connexion et à la bascule d'organisation (EVT-041).
   */
  useEffect(() => {
    setSessionLostHandler(() => {
      queryClient.clear();
      router.replace("/login");
    });

    // Retiré au démontage : en développement, React monte deux fois, et un
    // gestionnaire laissé en place capturerait un `QueryClient` mort.
    return () => setSessionLostHandler(null);
  }, [queryClient, router]);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
