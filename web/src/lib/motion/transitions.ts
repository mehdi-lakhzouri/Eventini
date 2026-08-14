import type { Transition } from "motion/react";

/**
 * Le vocabulaire de mouvement du produit — voir `docs/design/DESIGN_SYSTEM.md` §6.
 *
 * Ces valeurs existent pour être importées, pas recopiées. Une durée écrite à
 * la main dans un composant est une durée qui divergera : c'est exactement
 * ainsi qu'une interface finit avec sept vitesses d'apparition légèrement
 * différentes que personne ne sait réconcilier.
 *
 * Le respect de `prefers-reduced-motion` n'est PAS traité ici. Il l'est une
 * seule fois, par `<MotionConfig reducedMotion="user">` dans `AppProviders` —
 * la bibliothèque neutralise alors toute transformation sur chaque composant
 * `motion`, y compris ceux qui n'utiliseraient pas ce module. Le résoudre
 * transition par transition laisserait forcément un oubli.
 */

/** Durées en secondes — l'unité qu'attend motion, jamais des millisecondes. */
export const duration = {
  /** Changement de couleur, survol. Assez court pour être ressenti immédiat. */
  instant: 0.12,
  /** Apparition d'un élément, ouverture d'un menu. */
  fast: 0.18,
  /** Entrée de page, transition de contenu. */
  base: 0.26,
  /** Panneau latéral, feuille modale — la distance parcourue justifie la durée. */
  slow: 0.4,
} as const;

/**
 * Courbes d'accélération.
 *
 * `emphasized` est une courbe de sortie très marquée : l'élément démarre vite
 * puis se pose. C'est ce qui donne la sensation « produit fini » plutôt que
 * « transition CSS par défaut », et c'est le easing utilisé partout où il n'y
 * a pas de ressort.
 */
export const easing = {
  emphasized: [0.16, 1, 0.3, 1],
  standard: [0.4, 0, 0.2, 1],
  /** Pour ce qui sort de l'écran : accélère et disparaît, ne se pose pas. */
  exit: [0.4, 0, 1, 1],
} as const satisfies Record<string, [number, number, number, number]>;

/**
 * Ressorts, décrits en durée perçue plutôt qu'en raideur.
 *
 * `bounce: 0` donne un ressort critique — il arrive à destination sans
 * dépasser. C'est le réglage juste pour presque tout : le rebond attire
 * l'attention sur l'animation elle-même, ce qu'on ne veut que sur les rares
 * moments célébratoires.
 */
export const spring = {
  /** Dialogs, popovers, feuilles. */
  soft: { type: "spring", duration: 0.45, bounce: 0.12 },
  /** Éléments interactifs : le retour doit être immédiat. */
  snappy: { type: "spring", duration: 0.3, bounce: 0 },
  /** Réservé aux moments expressifs listés au §6.3 du design system. */
  expressive: { type: "spring", duration: 0.6, bounce: 0.28 },
} as const satisfies Record<string, Transition>;

/** Transition par défaut de l'application. */
export const defaultTransition: Transition = {
  duration: duration.base,
  ease: easing.emphasized,
};
