/**
 * Les clés de cache de la feature, dans leur propre fichier.
 *
 * Elles étaient dans `use-organizations.ts`, que les composants d'écriture
 * n'ont aucune raison d'importer — le faire aurait tiré `useActivateOrganization`
 * et sa purge de cache dans des modules qui ne basculent pas d'organisation.
 */
export const organizationQueryKeys = {
  list: ["organizations", "list"] as const,
  detail: (organizationId: string) =>
    ["organizations", "detail", organizationId] as const,
  members: (organizationId: string) =>
    ["organizations", "members", organizationId] as const,
  invitations: (organizationId: string) =>
    ["organizations", "invitations", organizationId] as const,
};
