import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { purgeClientCache } from "./purge-cache";

/**
 * La règle centrale d'EVT-041, et la plus facile à casser en croyant bien
 * faire : `clear()` et `invalidateQueries()` semblent interchangeables.
 */
describe("purgeClientCache", () => {
  const seeded = () => {
    const client = new QueryClient();

    client.setQueryData(["participants"], [{ id: "prt_1", name: "Ana" }]);
    client.setQueryData(["events"], [{ id: "evt_1" }]);

    return client;
  };

  /**
   * 🔴 Une invalidation **laisse les données en place** et se contente de les
   * marquer périmées : les réponses de l'organisation précédente resteraient
   * affichées jusqu'à leur remplacement. Sur un produit multi-tenant, c'est
   * une fuite cross-tenant côté client.
   */
  it("supprime les données, au lieu de les marquer périmées", () => {
    const client = seeded();

    purgeClientCache(client);

    expect(client.getQueryData(["participants"])).toBeUndefined();
    expect(client.getQueryData(["events"])).toBeUndefined();
  });

  it("ne laisse aucune entrée dans le cache", () => {
    const client = seeded();

    purgeClientCache(client);

    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  /**
   * Une invalidation seule échouerait ce test — c'est exactement sa différence
   * avec `clear()`, et la raison d'être de ce fichier.
   */
  it("se distingue d'une invalidation, qui conserverait les données", () => {
    const client = seeded();

    void client.invalidateQueries();

    // La donnée est toujours là après invalidation : elle est seulement
    // marquée périmée, donc encore affichable.
    expect(client.getQueryData(["participants"])).toEqual([
      { id: "prt_1", name: "Ana" },
    ]);
  });

  /**
   * Une requête déjà en vol se résoudrait après le `clear()` et réécrirait sa
   * réponse dans le cache tout juste vidé — réintroduisant la donnée qu'on
   * vient de supprimer, et seulement parfois, selon la latence. Le genre de
   * fuite qui ne se reproduit pas en développement.
   */
  it("annule les requêtes en vol avant de vider", () => {
    const client = seeded();
    const cancel = vi.spyOn(client, "cancelQueries");
    const clear = vi.spyOn(client, "clear");

    purgeClientCache(client);

    expect(cancel).toHaveBeenCalled();
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(
      clear.mock.invocationCallOrder[0]!,
    );
  });
});
