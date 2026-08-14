import type { QueryClient } from "@tanstack/react-query";

/**
 * Vide le cache client à chaque changement d'identité ou de contexte.
 *
 * ## 🔴 `clear()`, jamais `invalidateQueries()`
 *
 * C'est la distinction la plus importante de tout EVT-041, et elle n'est pas
 * intuitive : les deux méthodes semblent interchangeables et ne le sont pas.
 *
 * `invalidateQueries()` **laisse les données en place** et se contente de les
 * marquer périmées. Les réponses de l'organisation précédente restent donc
 * affichées jusqu'à ce qu'une requête les remplace — parfois plusieurs
 * secondes, parfois jamais si le composant ne se remonte pas.
 *
 * Sur un produit multi-tenant, c'est une **fuite cross-tenant côté client**. Le
 * backend a fait son travail : il a rejeté les requêtes hors contexte, roté la
 * session, révoqué la famille de jetons. C'est le cache du navigateur qui
 * trahit, en montrant à l'écran les participants d'une organisation depuis la
 * session d'une autre.
 *
 * `clear()` supprime tout, immédiatement. Les écrans repartent en chargement,
 * ce qui est exactement le comportement voulu : après une bascule, plus rien de
 * ce qui était affiché n'est encore valable.
 *
 * ## Les trois moments où l'appeler
 *
 * Après une **connexion**, après une **déconnexion**, et à la **bascule
 * d'organisation**. Les trois changent ce que l'utilisateur a le droit de voir,
 * et les trois laisseraient sinon des restes du contexte précédent.
 *
 * Écrit ici plutôt que recopié aux trois endroits : la règle est subtile, et
 * elle doit avoir un seul endroit où être lue — et corrigée.
 */
export function purgeClientCache(queryClient: QueryClient): void {
  /*
    `cancelQueries` d'abord. Une requête déjà en vol se résoudrait après le
    `clear()` et réécrirait sa réponse dans le cache tout juste vidé —
    réintroduisant précisément la donnée qu'on vient de supprimer, et
    seulement parfois, selon la latence. C'est le genre de fuite qui ne se
    reproduit pas en développement, où tout répond en cinq millisecondes.
  */
  void queryClient.cancelQueries();
  queryClient.clear();
}
