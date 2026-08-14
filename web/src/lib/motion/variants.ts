import type { Variants } from "motion/react";

import { duration, easing, spring } from "./transitions";

/**
 * Les figures de mouvement réutilisables — `docs/design/DESIGN_SYSTEM.md` §6.2.
 *
 * Toutes n'animent que `opacity`, `transform` et `filter`. C'est une contrainte
 * de performance, pas une préférence : ces trois propriétés sont composées par
 * le GPU sans repasser par la mise en page. Animer `height`, `top` ou `width`
 * force un recalcul de layout à chaque image et fait tomber les listes longues
 * sous les 60 images par seconde.
 */

/** Entrée standard : monte de 8px en s'opacifiant. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.base, ease: easing.emphasized },
  },
  exit: {
    opacity: 0,
    y: -4,
    transition: { duration: duration.fast, ease: easing.exit },
  },
};

/** Entrée sans déplacement, pour ce qui ne doit pas bouger sous le curseur. */
export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: duration.fast } },
  exit: { opacity: 0, transition: { duration: duration.instant } },
};

/**
 * Conteneur de liste échelonnée.
 *
 * `staggerChildren` à 40ms : au-delà de 60ms l'échelonnement se lit comme de la
 * lenteur plutôt que comme du rythme. `delayChildren` laisse le conteneur se
 * poser avant que ses enfants ne partent.
 *
 * À réserver aux listes courtes. Sur cinquante lignes, le dernier élément
 * arriverait deux secondes après le premier — utiliser `fade` à la place.
 */
export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.06 },
  },
};

/** Surface flottante : dialog, popover, feuille. */
export const surfaceIn: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: 4 },
  visible: { opacity: 1, scale: 1, y: 0, transition: spring.soft },
  exit: {
    opacity: 0,
    scale: 0.98,
    transition: { duration: duration.fast, ease: easing.exit },
  },
};

/**
 * Moment expressif — la liste fermée du §6.3 : écrans d'authentification,
 * bascule d'organisation, apparition des indicateurs du tableau de bord, toast
 * de succès critique, état vide illustré. Rien d'autre.
 */
export const expressiveIn: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: spring.expressive },
};

/** Retour tactile au clic. Sur `whileTap`, jamais dans un jeu de variantes. */
export const pressable = {
  whileTap: { scale: 0.98 },
  transition: spring.snappy,
} as const;
