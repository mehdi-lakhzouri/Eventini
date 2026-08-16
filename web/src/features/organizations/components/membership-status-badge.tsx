import { Badge } from "@/components/ui/badge";
import type { MembershipStatus } from "../types";

/**
 * Le statut, en français et avec sa charge visuelle.
 *
 * `REVOKED` et `EXPIRED` partagent l'apparence discrète plutôt que la
 * destructive : ce sont des états terminaux normaux, pas des alertes. Réserver
 * le rouge à `SUSPENDED` garde du sens à la couleur — c'est le seul statut sur
 * lequel un administrateur a quelque chose à faire.
 */
const PRESENTATION: Record<
  MembershipStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  ACTIVE: { label: "Actif", variant: "default" },
  INVITED: { label: "Invité", variant: "outline" },
  SUSPENDED: { label: "Suspendu", variant: "destructive" },
  REVOKED: { label: "Révoqué", variant: "secondary" },
  EXPIRED: { label: "Expiré", variant: "secondary" },
};

export function MembershipStatusBadge({ status }: { status: MembershipStatus }) {
  const presentation = PRESENTATION[status] ?? {
    label: status,
    variant: "secondary" as const,
  };

  return <Badge variant={presentation.variant}>{presentation.label}</Badge>;
}
