import { getRequestConfig } from "next-intl/server";

import { isSupportedLocale } from "./config";
import { routing } from "./routing";

/**
 * Charge le catalogue de la requête — EVT-047.
 *
 * ## 🔴 `requestLocale` doit être validé, pas fait confiance
 *
 * Le segment `[locale]` se comporte comme un attrape-tout : `/unknown.txt`
 * arrive ici avec `requestLocale === "unknown.txt"`. Le passer tel quel à
 * `next-intl` ferait échouer l'import du catalogue avec une erreur de module
 * introuvable — c'est-à-dire une 500 là où un 404 est attendu.
 *
 * Le repli sur la locale par défaut est donc une correction de robustesse, pas
 * une commodité. `undefined` est également légitime : une page rendue **hors**
 * du segment `[locale]` n'en a aucune.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale =
    requested !== undefined && isSupportedLocale(requested)
      ? requested
      : routing.defaultLocale;

  return {
    locale,
    /*
      Import dynamique : seul le catalogue de la locale servie part dans la
      réponse. Les importer tous les deux statiquement doublerait la charge
      utile pour que chaque visiteur transporte une langue qu'il ne lit pas.
    */
    messages: (await import(`../../messages/${locale}.json`)).default as Record<
      string,
      unknown
    >,

    /*
      Les horodatages sont rendus dans le fuseau du serveur si on ne dit rien,
      ce qui produit un rendu serveur et un rendu client différents pour un
      visiteur d'un autre fuseau — donc une erreur d'hydratation. Paris est le
      fuseau du marché visé ; le rendre explicite rend les deux rendus égaux.
    */
    timeZone: "Europe/Paris",
  };
});
