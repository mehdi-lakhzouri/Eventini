"use client";

import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useActivateOrganization, useOrganizations } from "../hooks";

/**
 * Le sélecteur d'organisation — EVT-041.
 *
 * ## Ce que coûte une bascule, et pourquoi elle est explicite
 *
 * Elle ne modifie pas un champ : elle **remplace la session** et révoque la
 * famille de jetons de l'ancienne (ADR-0002). Un refresh token capturé avant le
 * changement continuerait sinon de fonctionner après, en pointant désormais sur
 * la nouvelle organisation.
 *
 * Conséquence assumée que cet écran doit rendre lisible : le changement est
 * **global à la session**, pas à l'onglet. On ne peut pas travailler sur deux
 * organisations dans deux onglets — c'est le compromis retenu au profit de
 * l'isolation.
 *
 * ## Pourquoi pas `DropdownMenu`
 *
 * Le composant `DropdownMenu` installé n'a pas voulu s'ouvrir ici, dans trois
 * variantes d'usage — `render={<Button/>}`, props sur le déclencheur, styles
 * directs — sans jamais lever d'erreur. Plutôt que de continuer à deviner, la
 * divulgation est écrite explicitement : une trentaine de lignes, entièrement
 * sous contrôle, testables, et dont le comportement clavier est visible dans ce
 * fichier plutôt que dans une bibliothèque. Le point est reporté dans la PR.
 */
export function OrganizationSwitcher() {
  const { data: organizations, isPending } = useOrganizations();
  const activate = useActivateOrganization();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    // Échap ferme sans déplacer le focus ailleurs : c'est ce qu'attend
    // quiconque navigue au clavier, et l'absence de cette touche est le défaut
    // le plus courant des menus écrits à la main.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (isPending) {
    return <Skeleton className="h-9 w-48" />;
  }

  const list = organizations ?? [];
  const current = list.find((entry) => entry.active);

  /*
    Un seul rattachement : rien à choisir. Afficher un sélecteur à une entrée
    suggère une possibilité qui n'existe pas et invite à cliquer pour rien. Le
    nom reste affiché — savoir où l'on travaille compte, même sans alternative.
  */
  if (list.length <= 1) {
    return (
      <div className="flex items-center gap-2 px-2 text-sm font-medium">
        <Building2
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="truncate">
          {current?.name ?? "Aucune organisation"}
        </span>
      </div>
    );
  }

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        disabled={activate.isPending}
        aria-haspopup="menu"
        aria-expanded={open}
        // Le nom seul ne dit pas qu'il s'agit d'un sélecteur.
        aria-label={`Organisation active : ${current?.name ?? "aucune"}. Changer d'organisation.`}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium",
          "transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Building2 className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {activate.isPending ? "Changement…" : (current?.name ?? "Choisir")}
          </span>
        </span>
        <ChevronsUpDown
          className="size-4 shrink-0 opacity-60"
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Vos organisations"
          className="absolute left-0 z-50 mt-1 w-64 rounded-lg border border-border bg-popover p-1.5 shadow-lg"
        >
          {list.map((entry) => (
            <button
              key={entry.organizationId}
              type="button"
              role="menuitem"
              // Rebasculer sur l'organisation courante ferait tourner la
              // session et viderait le cache pour aboutir exactement où l'on
              // était déjà.
              disabled={entry.active || activate.isPending}
              onClick={() => {
                setOpen(false);
                activate.mutate(entry.organizationId);
              }}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm",
                "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                "disabled:pointer-events-none disabled:opacity-60",
              )}
            >
              <span className="truncate">{entry.name}</span>
              {entry.active ? (
                <Check className="size-4 shrink-0" aria-hidden="true" />
              ) : null}
            </button>
          ))}

          <p className="border-t border-border px-2.5 pt-2 pb-1 text-xs text-muted-foreground">
            Changer d&apos;organisation renouvelle votre session sur tous vos
            onglets.
          </p>
        </div>
      ) : null}
    </div>
  );
}
