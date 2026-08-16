/**
 * Les rôles qu'un administrateur d'organisation peut réellement accorder.
 *
 * ## 🔴 Cette liste est en dur, et ce n'est pas un raccourci
 *
 * **Aucune route n'expose le catalogue de rôles.** Vérifié le 16 août 2026 :
 * il n'existe ni `GET /roles`, ni `GET /organizations/{id}/roles`. Le backend
 * résout les codes qu'on lui envoie et refuse les autres, mais il n'a aucun
 * moyen de dire lesquels sont acceptables — le sélecteur ne peut donc pas se
 * peupler autrement.
 *
 * ## Ce que la base contient vraiment
 *
 * Interrogée le 16 août 2026, `CLIENT_ADMIN` est le **seul** rôle de portée
 * `ORGANIZATION` du catalogue seedé :
 *
 * | Rôle | Portée | Assignable ici |
 * |---|---|---|
 * | `CLIENT_ADMIN` | `ORGANIZATION` | oui |
 * | `EVENT_ADMIN` `REPORT_VIEWER` `SCANNER` `SESSION_MANAGER` | `EVENT` | non — `event_user_assignments`, sprint 09+ |
 * | `SUPER_ADMIN` | `PLATFORM` | non |
 *
 * Le ticket EVT-044 avait déjà relevé ce point : la route parle d'assignation
 * de rôles au pluriel, mais aujourd'hui elle accorde ou retire `CLIENT_ADMIN`.
 *
 * ## Le mode de défaillance si cette liste dérive
 *
 * Un code absent du catalogue seedé ne casse rien de visible : le backend
 * répond `400` avec le **même** message que pour un rôle plateforme, pour ne
 * pas énumérer ce à quoi l'appelant n'a pas droit. L'administrateur verrait
 * donc un rôle proposé qu'il ne peut pas accorder, sans savoir pourquoi.
 *
 * D'où le test qui accompagne ce fichier, et la note du ticket : la vraie
 * correction est une route de catalogue, pas une liste plus longue ici.
 */
export type AssignableRole = {
  readonly code: string;
  readonly label: string;
  readonly description: string;
};

export const ASSIGNABLE_ROLES: readonly AssignableRole[] = [
  {
    code: "CLIENT_ADMIN",
    label: "Administrateur",
    description:
      "Gère l'organisation, ses membres et leurs droits. C'est le seul rôle attribuable depuis cet écran.",
  },
];

export function assignableRoleLabel(code: string): string {
  return ASSIGNABLE_ROLES.find((role) => role.code === code)?.label ?? code;
}

/**
 * Le rôle proposé par défaut à l'invitation.
 *
 * Une constante dérivée plutôt qu'une chaîne recopiée : le jour où le
 * catalogue s'ouvre, le défaut suit sans qu'on ait à y penser.
 */
export const DEFAULT_INVITATION_ROLE = ASSIGNABLE_ROLES[0]!.code;
