"use client";

import { useState, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ConfirmActionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** Rouge pour ce qui ne se rattrape pas. */
  destructive?: boolean;
  /** Propose un champ de raison, transmis à l'audit. */
  withReason?: boolean;
  isPending: boolean;
  onConfirm: (reason: string | null) => void;
};

/**
 * La confirmation des actions de cycle de vie — EVT-046.
 *
 * ## Piloté, pas déclenché
 *
 * Le dialogue est **contrôlé** (`open` / `onOpenChange`) plutôt que monté avec
 * un `Trigger`. Une action de ligne dans un tableau doit savoir *quelle* ligne
 * elle vise : un `Trigger` par ligne monterait autant de dialogues que de
 * membres, et le dialogue partagé perdrait sa cible dès que la liste se
 * réordonne après invalidation.
 *
 * ## La raison n'est pas décorative
 *
 * Quand `withReason` est vrai, le texte saisi part dans `audit_logs` avec le
 * changement, dans la même transaction (EVT-045). C'est ce qui distingue
 * plus tard « suspendu par erreur » de « suspendu pour abus » — d'où le champ
 * facultatif mais proposé, plutôt qu'absent.
 */
export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  withReason = false,
  isPending,
  onConfirm,
}: ConfirmActionDialogProps) {
  const [reason, setReason] = useState("");

  const close = (next: boolean) => {
    if (!next) {
      // Vidé à la fermeture : sans cela, la raison d'une suspension
      // réapparaîtrait pré-remplie sur la révocation d'un autre membre.
      setReason("");
    }

    onOpenChange(next);
  };

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {withReason ? (
          <div className="space-y-2">
            <Label htmlFor="confirm-reason">Raison (facultative)</Label>
            <Textarea
              id="confirm-reason"
              value={reason}
              maxLength={500}
              rows={3}
              placeholder="Conservée dans le journal d'audit."
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Annuler</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={isPending}
            onClick={() =>
              onConfirm(reason.trim() === "" ? null : reason.trim())
            }
          >
            {isPending ? "En cours…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
