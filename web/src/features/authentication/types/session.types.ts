import type { SessionClientType } from "./authentication.types";

/**
 * Une session active, telle que `GET /auth/sessions` la renvoie.
 *
 * 🔴 Corrigé le 14 août 2026 (EVT-037). La version précédente déclarait
 * `{ id, deviceName, ipAddress, lastSeenAt: string | null, createdAt, current }`.
 * Le backend renvoie `sessionId` et non `id`, ajoute `clientType`, ne renvoie
 * **jamais** `ipAddress`, et `lastSeenAt` n'est pas nullable.
 *
 * L'absence d'`ipAddress` est un choix du backend, pas un oubli : une liste de
 * sessions est lisible par le porteur du compte, et une adresse IP y est une
 * donnée de localisation. Le champ existe en base pour l'audit, pas pour cet
 * écran.
 */
export type UserSession = {
  sessionId: string;
  clientType: SessionClientType;
  deviceName: string | null;
  createdAt: string;
  lastSeenAt: string;
  /**
   * La session qui porte la requête courante.
   *
   * EVT-041 s'en sert pour la distinguer dans la liste : révoquer sa propre
   * session depuis un écran de gestion des sessions déconnecte l'utilisateur
   * sans qu'il l'ait demandé.
   */
  current: boolean;
};
