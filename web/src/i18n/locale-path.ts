import { LOCALES } from "./config";

/**
 * Sépare le préfixe de locale du reste du chemin — EVT-047.
 *
 * ## Pourquoi ce n'est pas une expression régulière posée à la volée
 *
 * Le préfixe et le chemin sont manipulés au moins à trois endroits — le proxy,
 * les comparaisons de route active, le sélecteur de langue — et chacun se
 * tromperait différemment. Deux pièges concrets :
 *
 * - `/france` commence par `/fr`. Un `startsWith("/fr")` naïf le découperait
 *   en locale `fr` + chemin `ance`. Le test exige donc une frontière : fin de
 *   chaîne, ou `/` juste après.
 * - `/en` seul doit rendre le chemin `/`, pas la chaîne vide — cette dernière
 *   ne correspond à aucune entrée de `routes`, et la racine cesserait d'être
 *   reconnue comme publique.
 */
const LOCALE_SEGMENT = new RegExp(`^/(${LOCALES.join("|")})(?=/|$)`);

/** `/en/organization` → `/en` · `/organization` → `""`. */
export function localePrefixOf(pathname: string): string {
  return LOCALE_SEGMENT.exec(pathname)?.[0] ?? "";
}

/** `/en/organization` → `/organization` · `/en` → `/`. */
export function stripLocalePrefix(pathname: string): string {
  const stripped = pathname.replace(LOCALE_SEGMENT, "");

  return stripped === "" ? "/" : stripped;
}
