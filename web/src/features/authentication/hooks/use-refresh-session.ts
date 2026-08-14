"use client";

import { useMutation } from "@tanstack/react-query";

import { refreshSessionOnce } from "@/lib/api/session-refresh";

/**
 * Rotation manuelle des jetons.
 *
 * Délègue au coordinateur plutôt qu'à `refreshSession()` de la couche API, et
 * ce détail est le seul intérêt de ce fichier : un appel manuel emprunte ainsi
 * exactement le même chemin dédupliqué que le rattrapage automatique sur `401`.
 *
 * Appeler la route directement rouvrirait la faille qu'EVT-038 ferme. Une
 * rotation manuelle déclenchée pendant qu'une rotation automatique est en vol
 * présenterait un refresh token que la première vient de consommer, et le
 * backend révoquerait la famille entière pour rejeu — le scénario exact que le
 * coordinateur existe pour empêcher.
 *
 * Aucun appelant à ce jour. Le hook est conservé parce que la rotation
 * explicite a un usage prévu : réarmer une session avant une opération longue.
 */
export function useRefreshSession() {
  return useMutation({
    mutationFn: refreshSessionOnce,
  });
}
