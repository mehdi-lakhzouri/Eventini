"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

import {
  AA_THRESHOLD,
  contrastRatio,
  meetsAA,
  parseColor,
  type ContrastRequirement,
} from "@/lib/color/contrast";

type Pair = {
  readonly label: string;
  readonly foreground: string;
  readonly background: string;
  readonly requirement: ContrastRequirement;
  readonly note?: string;
};

/**
 * Chaque paire que le design system déclare conforme.
 *
 * Les entrées `non-text` correspondent à WCAG 1.4.11 : frontière de composant
 * ou indicateur d'état. `--border` n'y figure pas — c'est un séparateur
 * décoratif, hors périmètre du critère, et l'inscrire ici reviendrait à
 * signaler un échec sur une règle qui ne s'applique pas.
 */
const PAIRS: readonly Pair[] = [
  {
    label: "foreground / background",
    foreground: "--foreground",
    background: "--background",
    requirement: "text",
  },
  {
    label: "foreground / card",
    foreground: "--card-foreground",
    background: "--card",
    requirement: "text",
  },
  {
    label: "foreground / popover",
    foreground: "--popover-foreground",
    background: "--popover",
    requirement: "text",
  },
  {
    label: "muted-foreground / card",
    foreground: "--muted-foreground",
    background: "--card",
    requirement: "text",
  },
  {
    label: "muted-foreground / muted",
    foreground: "--muted-foreground",
    background: "--muted",
    requirement: "text",
  },
  {
    label: "primary-foreground / primary",
    foreground: "--primary-foreground",
    background: "--primary",
    requirement: "text",
  },
  {
    label: "primary-foreground / primary-hover",
    foreground: "--primary-foreground",
    background: "--primary-hover",
    requirement: "text",
    note: "état survol du bouton principal",
  },
  {
    label: "secondary-foreground / secondary",
    foreground: "--secondary-foreground",
    background: "--secondary",
    requirement: "text",
  },
  {
    label: "accent-foreground / accent",
    foreground: "--accent-foreground",
    background: "--accent",
    requirement: "text",
  },
  {
    label: "brand-foreground / brand",
    foreground: "--brand-foreground",
    background: "--brand",
    requirement: "text",
    note: "bouton de marque",
  },
  {
    label: "brand / card",
    foreground: "--brand",
    background: "--card",
    requirement: "text",
    note: "marque utilisée en texte",
  },
  {
    label: "success-foreground / success",
    foreground: "--success-foreground",
    background: "--success",
    requirement: "text",
  },
  {
    label: "warning-foreground / warning",
    foreground: "--warning-foreground",
    background: "--warning",
    requirement: "text",
    note: "texte foncé imposé sur l'ambre",
  },
  {
    label: "destructive-foreground / destructive",
    foreground: "--destructive-foreground",
    background: "--destructive",
    requirement: "text",
  },
  {
    label: "ring / background",
    foreground: "--ring",
    background: "--background",
    requirement: "non-text",
    note: "indicateur de focus",
  },
  {
    label: "ring / card",
    foreground: "--ring",
    background: "--card",
    requirement: "non-text",
  },
  {
    label: "input / card",
    foreground: "--input",
    background: "--card",
    requirement: "non-text",
    note: "frontière de champ",
  },
  {
    label: "input / background",
    foreground: "--input",
    background: "--background",
    requirement: "non-text",
  },
  {
    label: "input / muted",
    foreground: "--input",
    background: "--muted",
    requirement: "non-text",
    note: "pire cas — champ sur surface atténuée",
  },
  {
    label: "chart-1 / background",
    foreground: "--chart-1",
    background: "--background",
    requirement: "non-text",
  },
  {
    label: "chart-2 / background",
    foreground: "--chart-2",
    background: "--background",
    requirement: "non-text",
  },
  {
    label: "chart-3 / background",
    foreground: "--chart-3",
    background: "--background",
    requirement: "non-text",
  },
  {
    label: "chart-4 / background",
    foreground: "--chart-4",
    background: "--background",
    requirement: "non-text",
  },
  {
    label: "chart-5 / background",
    foreground: "--chart-5",
    background: "--background",
    requirement: "non-text",
  },
];

type Measured = Pair & { readonly ratio: number | null };

/**
 * Mesure les ratios sur les tokens **réellement appliqués au document**.
 *
 * C'est tout l'intérêt de cette page : les nombres ne sont pas recopiés de la
 * documentation, ils sont relus depuis `globals.css` à chaque rendu. Modifier
 * un token et oublier de mettre la doc à jour se voit ici immédiatement.
 */
export function ContrastAudit() {
  const { resolvedTheme } = useTheme();
  const [rows, setRows] = useState<Measured[] | null>(null);

  useEffect(() => {
    // Deux images d'attente : `next-themes` bascule la classe sur <html>, et
    // les variables ne sont recalculées qu'après le repaint suivant. Mesurer
    // immédiatement rendrait les valeurs du thème précédent.
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const styles = getComputedStyle(document.documentElement);

        setRows(
          PAIRS.map((pair) => {
            const foreground = parseColor(
              styles.getPropertyValue(pair.foreground),
            );
            const background = parseColor(
              styles.getPropertyValue(pair.background),
            );

            return {
              ...pair,
              ratio:
                foreground && background
                  ? contrastRatio(foreground, background)
                  : null,
            };
          }),
        );
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [resolvedTheme]);

  if (rows === null) {
    return (
      <div
        className="h-64 animate-pulse rounded-lg bg-muted"
        aria-label="Mesure des contrastes en cours"
      />
    );
  }

  const failures = rows.filter(
    (row) => row.ratio === null || !meetsAA(row.ratio, row.requirement),
  );

  return (
    <div className="space-y-4">
      <div
        // Région live : le résultat change quand on bascule le thème, et un
        // lecteur d'écran doit l'apprendre sans avoir à re-parcourir la page.
        aria-live="polite"
        className={`rounded-lg border p-4 text-sm font-medium ${
          failures.length === 0
            ? "border-success/30 bg-success/10 text-success"
            : "border-destructive/30 bg-destructive/10 text-destructive"
        }`}
      >
        {failures.length === 0
          ? `Les ${rows.length} paires déclarées satisfont AA en thème ${resolvedTheme === "dark" ? "sombre" : "clair"}.`
          : `${failures.length} paire(s) sous le seuil AA : ${failures.map((f) => f.label).join(", ")}.`}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Ratios de contraste mesurés sur les tokens appliqués
          </caption>
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th scope="col" className="py-2 pr-4 font-medium">
                Paire
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Exigence
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Mesuré
              </th>
              <th scope="col" className="py-2 font-medium">
                Verdict
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const passes =
                row.ratio !== null && meetsAA(row.ratio, row.requirement);

              return (
                <tr key={row.label} className="border-b border-border/60">
                  <td className="py-2 pr-4">
                    <span className="font-mono text-xs">{row.label}</span>
                    {row.note ? (
                      <span className="block text-xs text-muted-foreground">
                        {row.note}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4 text-xs text-muted-foreground">
                    {AA_THRESHOLD[row.requirement].toFixed(1)}:1
                  </td>
                  <td className="py-2 pr-4 text-right font-mono">
                    {row.ratio === null ? "—" : `${row.ratio.toFixed(2)}:1`}
                  </td>
                  <td className="py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        passes
                          ? "bg-success/15 text-success"
                          : "bg-destructive/15 text-destructive"
                      }`}
                    >
                      {row.ratio === null
                        ? "non mesurable"
                        : passes
                          ? "AA"
                          : "échec"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
