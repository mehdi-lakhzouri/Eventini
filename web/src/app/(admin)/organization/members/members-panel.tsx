"use client";

import { permissions } from "@/config/permissions";
import { usePermissions } from "@/features/authentication";
import {
  InvitationsTable,
  InviteMemberForm,
  MembersTable,
  OrganizationScope,
} from "@/features/organizations";

/**
 * Le corps de l'écran des membres — EVT-046.
 *
 * Séparé de `page.tsx` pour que la frontière `"use client"` tombe **sous** le
 * `Suspense` de la page. L'inverse — un `"use client"` sur la page — mettrait
 * la frontière au-dessus, et `useSearchParams` se retrouverait sans frontière
 * de suspense au-dessus de lui.
 *
 * 🔴 Les sections sont masquées selon les permissions, ce qui n'autorise
 * **rien** : le backend exige `users.read` et `users.invite` sur ses propres
 * routes et refuserait de la même façon. Le masquage évite d'afficher un
 * formulaire dont chaque envoi répondrait `403`.
 */
export function MembersPanel() {
  const { can, isPending } = usePermissions();

  if (isPending) {
    return null;
  }

  const canRead = can(permissions.readMembers);
  const canInvite = can(permissions.inviteMembers);

  if (!canRead && !canInvite) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
        Vous n&apos;avez pas les droits nécessaires pour administrer les membres
        de cette organisation.
      </p>
    );
  }

  return (
    <OrganizationScope>
      {(organizationId) => (
        <div className="space-y-10">
          {canInvite ? (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold tracking-tight">
                Inviter quelqu&apos;un
              </h2>
              <InviteMemberForm organizationId={organizationId} />
            </section>
          ) : null}

          {canRead ? (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold tracking-tight">
                Membres de l&apos;organisation
              </h2>
              <MembersTable organizationId={organizationId} />
            </section>
          ) : null}

          {canInvite ? (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold tracking-tight">
                Invitations en cours
              </h2>
              <InvitationsTable organizationId={organizationId} />
            </section>
          ) : null}
        </div>
      )}
    </OrganizationScope>
  );
}
