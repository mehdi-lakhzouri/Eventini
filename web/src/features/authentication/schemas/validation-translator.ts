import type { useTranslations } from "next-intl";

/**
 * Le traducteur que les schémas reçoivent — EVT-047.
 *
 * ## 🔴 Pourquoi les schémas deviennent des fabriques
 *
 * Un schéma Zod fige ses messages **au moment où il est construit**. Déclaré au
 * niveau du module, il les fige donc une fois pour tout le processus, dans la
 * langue qui se trouvait là — et un utilisateur anglophone recevait des refus
 * de validation en français sur une interface par ailleurs traduite.
 *
 * Les construire dans le composant, à partir du traducteur de la requête, est
 * la seule façon de les faire suivre la locale. Le coût est une signature qui
 * change et un `useMemo` par formulaire.
 *
 * ## Le type exact plutôt qu'un alias commode
 *
 * La première version de ce fichier déclarait `(key: string) => string`, ce qui
 * paraissait suffisant. TypeScript l'a refusé : le traducteur de `next-intl`
 * n'accepte pas `string`, mais l'union des clés réellement présentes dans le
 * catalogue.
 *
 * Le refus était le bon. En reprenant le type de la bibliothèque, une clé mal
 * orthographiée **à l'intérieur d'un schéma** échoue au `typecheck` comme
 * ailleurs, au lieu de rendre la clé brute dans un message d'erreur — c'est-à-dire
 * à l'endroit précis où un utilisateur la lirait au pire moment.
 */
export type ValidationTranslator = ReturnType<
  typeof useTranslations<"validation">
>;
