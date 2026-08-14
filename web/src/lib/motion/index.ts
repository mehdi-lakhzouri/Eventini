/**
 * Surface publique du vocabulaire de mouvement.
 *
 * `useReducedMotion` est réexporté depuis la bibliothèque plutôt que
 * réimplémenté : elle écoute déjà le média `prefers-reduced-motion` et se
 * remet à jour quand la préférence change en cours de session, ce qu'une
 * lecture unique au montage manquerait.
 */
export { useReducedMotion } from "motion/react";
export {
  defaultTransition,
  duration,
  easing,
  spring,
} from "./transitions";
export {
  expressiveIn,
  fade,
  fadeUp,
  pressable,
  staggerContainer,
  surfaceIn,
} from "./variants";
