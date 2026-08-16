"use client";

import { Laptop, ScanLine, Server } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@/i18n/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { routes } from "@/config/routes";
import { purgeClientCache } from "@/lib/query/purge-cache";
import { revokeAllSessions, revokeSession } from "../api/sessions.api";
import { authenticationQueryKeys } from "../constants/authentication.constants";
import { useSessions } from "../hooks/use-sessions";
import { userMessageFor } from "../utils/form-errors";
import { ApiError } from "@/lib/api/api-error";
import type { SessionClientType, UserSession } from "../types";
import { FormMessage } from "./form-message";

const DEVICE_ICON: Record<SessionClientType, typeof Laptop> = {
  WEB: Laptop,
  MOBILE_SCANNER: ScanLine,
  PLATFORM: Server,
};

/** Un horodatage ISO en texte lisible, en français. */
function formatMoment(iso: string): string {
  const date = new Date(iso);

  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

/**
 * Les sessions actives du porteur, et leur révocation — EVT-041.
 *
 * `GET /auth/sessions` ne renvoie **pas** d'adresse IP : c'est un choix du
 * backend, pas un oubli. Une liste de sessions est lisible par le porteur du
 * compte, et une adresse IP y est une donnée de localisation. Le champ existe
 * en base pour l'audit, pas pour cet écran.
 */
export function SessionList() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: sessions, isPending, isError, error } = useSessions();

  const revokeOne = useMutation({
    mutationFn: revokeSession,
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: authenticationQueryKeys.sessions,
      }),
  });

  /*
    Révoquer TOUT inclut la session courante : l'utilisateur se déconnecte
    lui-même, ce qui est précisément l'intérêt du bouton après un vol
    d'appareil. D'où la purge complète et la redirection — la simple
    invalidation utilisée pour une révocation ciblée laisserait ici l'écran
    afficher les données d'une session qui n'existe plus.
  */
  const revokeAll = useMutation({
    mutationFn: revokeAllSessions,
    onSuccess: () => {
      purgeClientCache(queryClient);
      router.replace(routes.login);
    },
  });

  if (isPending) {
    return (
      <div className="space-y-3" aria-busy="true">
        <span className="sr-only">Chargement de vos sessions…</span>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <FormMessage
        message={
          error instanceof ApiError
            ? userMessageFor(error)
            : "Vos sessions n'ont pas pu être chargées."
        }
      />
    );
  }

  const list = sessions ?? [];

  return (
    <div className="space-y-4">
      <FormMessage
        message={
          revokeOne.error instanceof ApiError
            ? userMessageFor(revokeOne.error)
            : undefined
        }
      />

      <ul className="space-y-3">
        {list.map((session) => (
          <SessionRow
            key={session.sessionId}
            session={session}
            onRevoke={() => revokeOne.mutate(session.sessionId)}
            isRevoking={
              revokeOne.isPending && revokeOne.variables === session.sessionId
            }
          />
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
        <div className="text-sm">
          <p className="font-medium">Tout déconnecter</p>
          <p className="text-muted-foreground">
            Ferme toutes les sessions, y compris celle-ci.
          </p>
        </div>
        <Button
          variant="destructive"
          onClick={() => revokeAll.mutate()}
          disabled={revokeAll.isPending}
        >
          {revokeAll.isPending ? "Déconnexion…" : "Tout déconnecter"}
        </Button>
      </div>
    </div>
  );
}

function SessionRow({
  session,
  onRevoke,
  isRevoking,
}: {
  session: UserSession;
  onRevoke: () => void;
  isRevoking: boolean;
}) {
  const Icon = DEVICE_ICON[session.clientType] ?? Laptop;

  return (
    <li className="flex items-center gap-4 rounded-lg border border-border bg-card p-4 shadow-sm">
      <Icon
        className="size-5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <span className="truncate">
            {session.deviceName ?? "Appareil inconnu"}
          </span>
          {session.current ? (
            <Badge variant="secondary">Cette session</Badge>
          ) : null}
        </p>
        <p className="text-muted-foreground">
          Vue le {formatMoment(session.lastSeenAt)} · ouverte le{" "}
          {formatMoment(session.createdAt)}
        </p>
      </div>

      {/*
        La session courante n'est pas révocable ici. Le bouton « Tout
        déconnecter » existe pour cela et annonce sa conséquence ; un bouton
        de ligne déconnecterait l'utilisateur sans qu'il l'ait demandé, depuis
        un écran où il gérait ses AUTRES appareils.
      */}
      {session.current ? null : (
        <Button
          variant="outline"
          size="sm"
          onClick={onRevoke}
          disabled={isRevoking}
          aria-label={`Révoquer la session ${session.deviceName ?? "inconnue"}`}
        >
          {isRevoking ? "Révocation…" : "Révoquer"}
        </Button>
      )}
    </li>
  );
}
