"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

import { defaultTransition } from "@/lib/motion";

/**
 * Le respect de `prefers-reduced-motion`, réglé une seule fois pour tout l'arbre.
 *
 * `reducedMotion="user"` demande à la bibliothèque de neutraliser toute
 * animation de transformation — déplacement, échelle, rotation — dès que la
 * préférence système est active, en conservant les fondus d'opacité. C'est
 * exactement la règle de FRONTEND_ARCHITECTURE.md §12.
 *
 * Pourquoi ici plutôt que composant par composant : la règle CSS de
 * `globals.css` ne couvre que les transitions et animations CSS. Le mouvement
 * piloté en JavaScript par `motion` lui échappe entièrement. Le traiter dans
 * chaque composant marcherait jusqu'au premier oubli, et un oubli sur ce
 * critère n'est pas un défaut cosmétique : le mouvement déclenche des troubles
 * vestibulaires réels chez les personnes concernées.
 *
 * Le registre retenu étant expressif — ressorts, transitions de page,
 * échelonnements — l'échappatoire compte d'autant plus.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={defaultTransition}>
      {children}
    </MotionConfig>
  );
}
