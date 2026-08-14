"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Bascule clair / sombre pour la recette visuelle.
 *
 * Aucun état de montage, et c'est délibéré. Le réflexe habituel — un
 * `useState(false)` passé à `true` dans un effet pour éviter la discordance
 * d'hydratation — provoque un rendu en cascade que le compilateur React refuse
 * désormais, à juste titre : le serveur ne peut pas connaître le thème résolu,
 * mais il n'a pas besoin de le connaître.
 *
 * `next-themes` pose la classe `dark` sur `<html>` avant la peinture. L'icône
 * et le libellé visibles sont donc choisis par CSS, ce qui rend le balisage
 * identique côté serveur et côté client. `resolvedTheme` n'est lu qu'au clic,
 * c'est-à-dire nécessairement après l'hydratation.
 */
export function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      // Formulation valable dans les deux états : un libellé accessible qui
      // dépendrait du thème serait faux pendant la première image.
      aria-label="Basculer entre le thème clair et le thème sombre"
    >
      <Moon className="dark:hidden" aria-hidden="true" />
      <Sun className="hidden dark:block" aria-hidden="true" />
      <span className="dark:hidden">Sombre</span>
      <span className="hidden dark:inline">Clair</span>
    </Button>
  );
}
