"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

type Swatch = {
  readonly token: string;
  readonly role: string;
};

const GROUPS: readonly { title: string; swatches: readonly Swatch[] }[] = [
  {
    title: "Surfaces",
    swatches: [
      { token: "--background", role: "fond de page" },
      { token: "--card", role: "carte, panneau" },
      { token: "--popover", role: "surface flottante" },
      { token: "--muted", role: "surface atténuée" },
      { token: "--secondary", role: "surface secondaire" },
    ],
  },
  {
    title: "Marque",
    swatches: [
      { token: "--primary", role: "action principale" },
      { token: "--primary-hover", role: "survol de l'action principale" },
      { token: "--brand", role: "accent de marque" },
    ],
  },
  {
    title: "États",
    swatches: [
      { token: "--success", role: "confirmation" },
      { token: "--warning", role: "avertissement" },
      { token: "--destructive", role: "erreur, suppression" },
    ],
  },
  {
    title: "Traits",
    swatches: [
      { token: "--border", role: "séparateur décoratif" },
      { token: "--input", role: "frontière de champ" },
      { token: "--ring", role: "indicateur de focus" },
    ],
  },
  {
    title: "Série catégorielle",
    swatches: [
      { token: "--chart-1", role: "série 1" },
      { token: "--chart-2", role: "série 2" },
      { token: "--chart-3", role: "série 3" },
      { token: "--chart-4", role: "série 4" },
      { token: "--chart-5", role: "série 5" },
    ],
  },
];

/** Affiche chaque token avec la valeur que le navigateur applique réellement. */
export function TokenSwatches() {
  const { resolvedTheme } = useTheme();
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const styles = getComputedStyle(document.documentElement);
        const next: Record<string, string> = {};

        for (const group of GROUPS) {
          for (const swatch of group.swatches) {
            next[swatch.token] = styles
              .getPropertyValue(swatch.token)
              .trim();
          }
        }

        setValues(next);
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [resolvedTheme]);

  return (
    <div className="space-y-8">
      {GROUPS.map((group) => (
        <section key={group.title}>
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
            {group.title}
          </h3>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {group.swatches.map((swatch) => (
              <li
                key={swatch.token}
                className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
              >
                <div
                  className="h-16 w-full border-b border-border"
                  style={{ background: `var(${swatch.token})` }}
                  // Décoratif : la valeur est donnée en texte juste dessous,
                  // donc l'annoncer deux fois n'aiderait personne.
                  aria-hidden="true"
                />
                <div className="space-y-0.5 p-3">
                  <p className="font-mono text-xs font-medium">{swatch.token}</p>
                  <p className="text-xs text-muted-foreground">{swatch.role}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {values[swatch.token] || "…"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
