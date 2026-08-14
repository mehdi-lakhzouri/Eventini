import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "@/lib/api/api-error";

/**
 * Ne pas réessayer ce qui ne changera pas d'avis.
 *
 * Un `403` ne s'améliore pas entre deux tentatives : la permission
 * n'apparaîtra pas toute seule. Un `404` non plus. Un `401` est traité en
 * amont par la rotation en vol unique (`session-refresh.ts`) — le réessayer
 * ici doublerait le mécanisme et ferait repartir des requêtes que la
 * redirection vers la connexion vient d'invalider.
 *
 * Les réessais par défaut de TanStack Query (trois, avec repli exponentiel)
 * transformeraient chacun de ces cas en quatre requêtes et quatre lignes de
 * journal côté backend, pour un résultat identique.
 */
const NEVER_RETRIED = [400, 401, 403, 404, 409, 422];

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          if (error instanceof ApiError) {
            // Le backend sait mieux que nous : `retryable` est porté par
            // l'enveloppe RFC 9457 (EVT-037). Une indisponibilité de dépendance
            // le déclare vrai, une erreur de validation non.
            if (NEVER_RETRIED.includes(error.status)) {
              return false;
            }

            return error.retryable && failureCount < 2;
          }

          // Panne réseau, ou tout ce qui n'a pas atteint le serveur.
          return failureCount < 2;
        },
        /**
         * Trente secondes plutôt que zéro. Par défaut, chaque montage de
         * composant refait la requête ; sur un tableau de bord qui monte dix
         * hooks, cela signifie dix requêtes à chaque navigation.
         */
        staleTime: 30_000,
      },
      mutations: {
        // Une mutation n'est pas idempotente par défaut. La rejouer peut créer
        // deux inscriptions là où l'utilisateur en voulait une — c'est à
        // `Idempotency-Key` de rendre un rejeu sûr, pas au client de le
        // décider tout seul.
        retry: false,
      },
    },
  });
}
