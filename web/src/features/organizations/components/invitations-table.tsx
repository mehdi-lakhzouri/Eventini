"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError } from "@/lib/api/api-error";
import { assignableRoleLabel } from "../constants/assignable-roles";
import { useInvitationMutations, useInvitations } from "../hooks";
import type { InvitationStatus } from "../types";
import { ConfirmActionDialog } from "./confirm-action-dialog";

const STATUS_LABEL: Record<InvitationStatus, string> = {
  PENDING: "En attente",
  ACCEPTED: "Acceptée",
  REVOKED: "Révoquée",
  EXPIRED: "Expirée",
};

function formatDate(iso: string): string {
  const date = new Date(iso);

  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

/**
 * Les invitations en cours — EVT-046.
 *
 * Seules les invitations `PENDING` sont révocables : révoquer une invitation
 * déjà acceptée ne voudrait rien dire — c'est le **membership** qu'il faut
 * alors retirer, depuis la table des membres.
 */
export function InvitationsTable({
  organizationId,
}: {
  organizationId: string;
}) {
  const { data, isPending, isError, error } = useInvitations(organizationId);
  const { revoke } = useInvitationMutations(organizationId);
  const [target, setTarget] = useState<{ id: string; email: string } | null>(
    null,
  );
  const [feedback, setFeedback] = useState<string | null>(null);

  if (isPending) {
    return (
      <div className="space-y-3" aria-busy="true">
        <span className="sr-only">Chargement des invitations…</span>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error instanceof ApiError
          ? error.message
          : "Les invitations n'ont pas pu être chargées."}
      </p>
    );
  }

  const invitations = data ?? [];

  if (invitations.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Aucune invitation. Utilisez le formulaire ci-dessus pour en créer une.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {feedback === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {feedback}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Adresse</TableHead>
              <TableHead>Rôle</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Expire le</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.map((invitation) => (
              <TableRow key={invitation.invitationId}>
                <TableCell className="font-medium">
                  {invitation.email}
                </TableCell>
                <TableCell>
                  {assignableRoleLabel(invitation.roleCode)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      invitation.status === "PENDING" ? "outline" : "secondary"
                    }
                  >
                    {STATUS_LABEL[invitation.status] ?? invitation.status}
                  </Badge>
                </TableCell>
                <TableCell>{formatDate(invitation.expiresAt)}</TableCell>
                <TableCell className="text-right">
                  {invitation.status === "PENDING" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() =>
                        setTarget({
                          id: invitation.invitationId,
                          email: invitation.email,
                        })
                      }
                    >
                      Révoquer
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmActionDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTarget(null);
          }
        }}
        title={`Révoquer l'invitation de ${target?.email ?? ""} ?`}
        description="Le lien déjà transmis cessera de fonctionner. Une nouvelle invitation peut être créée ensuite."
        confirmLabel="Révoquer"
        destructive
        isPending={revoke.isPending}
        onConfirm={() => {
          if (target === null) {
            return;
          }

          setFeedback(null);
          revoke.mutate(
            { invitationId: target.id },
            {
              onSuccess: () => setTarget(null),
              onError: (revokeError) =>
                setFeedback(
                  revokeError instanceof ApiError
                    ? revokeError.message
                    : "La révocation a échoué.",
                ),
            },
          );
        }}
      />
    </div>
  );
}
