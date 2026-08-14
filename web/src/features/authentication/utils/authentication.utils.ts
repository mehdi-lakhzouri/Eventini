import type { Role } from "../types";

/**
 * 🔴 **Le backend ne renvoie aujourd'hui ni rôle ni permission au client.**
 *
 * Vérifié le 14 août 2026 : `GET /auth/me` renvoie l'identité, la session et
 * le niveau d'authentification — jamais `role`, jamais `permissions`. Aucune
 * autre route n'en expose. [ADR-0004] résout les permissions côté serveur à
 * chaque requête, précisément pour qu'un client ne puisse pas les présumer.
 *
 * La version précédente lisait `user.role` sur un type qui déclarait ce champ
 * à tort : la fonction retournait donc `false` **en toutes circonstances**, en
 * silence. Un `AuthGuard` la consultant aurait masqué chaque page protégée à
 * des utilisateurs parfaitement légitimes, sans qu'aucun test ne s'en plaigne.
 *
 * La signature prend désormais le rôle **explicitement**. Il n'y a pas de
 * source à laquelle le lire, et une fonction qui prétend le déduire d'un objet
 * qui ne le porte pas est pire qu'une fonction qui demande la donnée.
 *
 * EVT-039 doit trancher d'où vient ce rôle — vraisemblablement une extension
 * de `GET /auth/me`, qui est un changement **backend**. Voir la note de fin de
 * la PR EVT-037.
 */
export function userHasRole(
  role: Role | null | undefined,
  required: Role,
): boolean {
  return role === required;
}
