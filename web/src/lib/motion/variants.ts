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

/** Entrée dédiée à la grande carte d'authentification. */
export const authCardIn: Variants = {
  hidden: { opacity: 0, y: 22, scale: 0.9 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: spring.authCard,
  },
};

/** Les bénéfices marketing arrivent du bas, dans un rythme lisible. */
export const authFeatureList: Variants = {
  hidden: {},
  visible: {
    transition: { delayChildren: 1.35, staggerChildren: 0.16 },
  },
};

export const authFeatureItem: Variants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.slow, ease: easing.emphasized },
  },
};

/** Conteneur et glyphe d'un texte saisi caractère après caractère. */
export const typewriterContainer: Variants = {
  hidden: {},
  visible: (delay = 0) => ({
    transition: { delayChildren: delay, staggerChildren: 0.018 },
  }),
};

export const typewriterCharacter: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: duration.instant } },
};

/** Entrée plus retenue de la carte « mot de passe oublié ». */
export const forgotCardIn: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.985 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.5, ease: easing.emphasized },
  },
};

/** Révélation presque imperceptible des éléments du formulaire. */
export const forgotContentList: Variants = {
  hidden: {},
  visible: {
    transition: { delayChildren: 0.12, staggerChildren: 0.055 },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: duration.fast, ease: easing.exit },
  },
};

export const forgotContentItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.base, ease: easing.emphasized },
  },
};

export const forgotKeyIn: Variants = {
  hidden: { opacity: 0, scale: 0.9, rotate: -5 },
  visible: {
    opacity: 1,
    scale: 1,
    rotate: 0,
    transition: spring.soft,
  },
};

export const forgotSuccessIn: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { staggerChildren: 0.06, delayChildren: 0.05 },
  },
};

export const forgotErrorShake: Variants = {
  rest: { x: 0 },
  error: {
    x: [0, -3, 3, -2, 2, 0],
    transition: { duration: duration.base, ease: easing.standard },
  },
};

export const subtleButtonInteraction: Variants = {
  rest: { y: 0, scale: 1 },
  hover: {
    y: -1,
    transition: { duration: duration.fast, ease: easing.emphasized },
  },
  pressed: {
    scale: 0.985,
    transition: { duration: duration.instant, ease: easing.standard },
  },
};

/** Carte et contenu de la vérification MFA. */
export const mfaCardIn: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.985 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.48, ease: easing.emphasized },
  },
};

export const mfaContentList: Variants = {
  hidden: {},
  visible: {
    transition: { delayChildren: 0.1, staggerChildren: 0.05 },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: duration.fast, ease: easing.exit },
  },
};

export const mfaContentItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.base, ease: easing.emphasized },
  },
};

export const mfaShieldIn: Variants = {
  hidden: { opacity: 0, scale: 0.9, rotate: -4 },
  visible: { opacity: 1, scale: 1, rotate: 0, transition: spring.soft },
};

export const mfaErrorShake: Variants = {
  rest: { x: 0 },
  error: {
    x: [0, -3, 3, -2, 2, 0],
    transition: { duration: 0.28, ease: easing.standard },
  },
};

export const mfaSuccessIn: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { ...spring.soft, staggerChildren: 0.06 },
  },
};

/** Retour tactile au clic. Sur `whileTap`, jamais dans un jeu de variantes. */
export const pressable = {
  whileTap: { scale: 0.98 },
  transition: spring.snappy,
} as const;
