"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { routes } from "@/config/routes";

/**
 * Le lien d'acceptation, affiché une seule fois — EVT-046.
 *
 * ## 🔴 Pourquoi cet écran existe, et pourquoi il devra disparaître
 *
 * `POST .../invitations` rend `acceptanceToken` **une fois**. La base n'en garde
 * que l'empreinte HMAC (EVT-043), donc il est irrécupérable : ni rechargement,
 * ni relecture ne le retrouveront. Sans cet affichage, une invitation créée
 * serait une invitation intransmissible tant qu'EVT-073 n'envoie pas les
 * courriels.
 *
 * La conséquence est écrite noir sur blanc à l'écran, parce qu'elle est réelle :
 * **l'invitant voit le jeton**, donc il peut accepter l'invitation à la place de
 * l'invité, depuis n'importe quelle adresse. La possession du jeton cesse de
 * prouver le contrôle de la boîte mail. Le backend le documente déjà comme un
 * compromis assumé de l'intérim ; le taire dans l'interface le rendrait
 * invisible à la seule personne en mesure d'en tenir compte.
 */
export function AcceptanceLinkNotice({
  email,
  token,
  onDismiss,
}: {
  email: string;
  token: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const link =
    typeof window === "undefined"
      ? `${routes.acceptInvitation}?token=${encodeURIComponent(token)}`
      : `${window.location.origin}${routes.acceptInvitation}?token=${encodeURIComponent(token)}`;

  const copy = () => {
    void navigator.clipboard
      .writeText(link)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  return (
    <div
      role="status"
      className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-4"
    >
      <div className="space-y-1">
        <p className="text-sm font-medium">
          Invitation créée pour {email}
        </p>
        <p className="text-sm text-muted-foreground">
          Transmettez ce lien vous-même : l&apos;envoi automatique de courriels
          n&apos;existe pas encore. <strong>Il ne sera plus affiché</strong> —
          seule son empreinte est conservée. Toute personne qui l&apos;obtient
          peut accepter l&apos;invitation à la place du destinataire.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1 space-y-1.5">
          <Label htmlFor="acceptance-link">Lien d&apos;acceptation</Label>
          <Input id="acceptance-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
        </div>
        <Button type="button" variant="outline" onClick={copy}>
          {copied ? "Copié" : "Copier"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDismiss}>
          Masquer
        </Button>
      </div>
    </div>
  );
}
