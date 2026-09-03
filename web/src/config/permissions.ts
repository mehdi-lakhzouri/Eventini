/**
 * Les codes de permission tels que le catalogue les seede.
 *
 * 🔴 Les trois valeurs précédentes — `identity.sessions.manage-own`,
 * `identity.users.manage-tenant`, `platform.manage` — **n'existaient dans
 * aucun rôle**. Vérifié le 14 août 2026 contre `prisma/seed/`, qui définit 33
 * permissions : aucune ne portait ces noms.
 *
 * Le fichier n'étant importé nulle part (défaut F-11), l'erreur ne pouvait pas
 * se voir. Elle se serait vue au premier usage, sous la forme la plus
 * déroutante possible : une action masquée pour tout le monde, y compris pour
 * l'administrateur, sans qu'aucune erreur ne soit levée — `hasPermission`
 * répond simplement `false` sur un code inconnu.
 *
 * Rappel — le frontend n'est jamais une frontière de sécurité (AUTH-INV-011).
 * Ces codes décident d'un affichage ; le backend réautorise à chaque requête.
 */
export const permissions = {
  // Sessions — l'écran /account/sessions
  readSessions: "sessions.read",
  revokeSessions: "sessions.revoke",

  // Organisation
  readOrganization: "organizations.read",
  manageOrganization: "organizations.manage",

  /*
    Membres — l'écran /organization/members (EVT-046).

    Les trois codes manquaient. Vérifié le 16 août 2026 contre la base : le rôle
    `CLIENT_ADMIN` porte exactement `organizations.manage`, `organizations.read`,
    `users.invite`, `users.manage_roles` et `users.read` — les deux premiers
    étaient déclarés ici, les trois autres non, alors que ce sont précisément
    ceux dont l'administration des membres a besoin.

    L'absence ne se voyait pas : `hasPermission` répond `false` sur un code
    inconnu, donc l'oubli aurait masqué toutes les actions pour tout le monde,
    administrateur compris, sans lever la moindre erreur.
  */
  readMembers: "users.read",
  inviteMembers: "users.invite",
  manageMemberRoles: "users.manage_roles",

  // Événements
  readEvents: "events.read",
  createEvents: "events.create",
  updateEvents: "events.update",
  activateEvents: "events.activate",
  cancelEvents: "events.cancel",
  manageEventSessions: "event_sessions.manage",

  // Participants et inscriptions
  readParticipants: "participants.read",
  importParticipants: "participants.import",
  exportParticipants: "participants.export",
  readRegistrations: "registrations.read",
  manageRegistrations: "registrations.manage",

  // Rapports
  readReports: "reports.read",
  exportReports: "reports.export",

  // Plateforme — jamais accordées par un rôle d'organisation
  managePlatformOrganizations: "platform.organizations.manage",
  impersonateUsers: "platform.users.impersonate",
  executeKillSwitch: "platform.kill_switch.execute",
} as const;

export type PermissionCode = (typeof permissions)[keyof typeof permissions];
