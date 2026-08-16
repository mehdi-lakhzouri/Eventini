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
  authSubmitMotion,
  defaultTransition,
  duration,
  easing,
  spring,
} from "./transitions";
export {
  authCardIn,
  authFeatureItem,
  authFeatureList,
  expressiveIn,
  fade,
  fadeUp,
  forgotCardIn,
  forgotContentItem,
  forgotContentList,
  forgotErrorShake,
  forgotKeyIn,
  forgotSuccessIn,
  mfaCardIn,
  mfaContentItem,
  mfaContentList,
  mfaErrorShake,
  mfaShieldIn,
  mfaSuccessIn,
  pressable,
  staggerContainer,
  surfaceIn,
  subtleButtonInteraction,
  typewriterCharacter,
  typewriterContainer,
} from "./variants";
