import { defineRouting } from "next-intl/routing";

import { DEFAULT_LOCALE, LOCALES } from "./config";

/**
 * Le routage par locale — EVT-047.
 *
 * ## `as-needed` : `/dashboard` en français, `/en/dashboard` en anglais
 *
 * Le ticket le demande explicitement, et c'est le bon compromis pour ce
 * produit : le marché visé est francophone (ADR-0001), donc préfixer la langue
 * majoritaire alourdirait chaque adresse partagée sans rien apporter. La langue
 * minoritaire, elle, doit être nommée pour être atteignable et partageable.
 *
 * Conséquence à connaître : un chemin **sans** préfixe est du français, jamais
 * « la langue du navigateur ». C'est ce qui rend une URL stable — un lien
 * envoyé à un collègue ouvre la même page dans la même langue, quel que soit
 * son navigateur.
 *
 * ## 🔴 `localeDetection: false` — l'URL décide, pas le navigateur
 *
 * Activée (le défaut), la détection ne se contente **pas** de négocier à la
 * racine : elle redirige **tout** chemin non préfixé vers la locale déduite
 * d'`Accept-Language`. Constaté en e2e — un navigateur configuré en anglais
 * ouvrant `/account/sessions` se retrouvait sur `/en/account/sessions`.
 *
 * C'est le contraire de ce qu'on veut ici, pour deux raisons.
 *
 * Un lien doit être stable : `/organization/members` envoyé à un collègue doit
 * ouvrir la même page dans la même langue, quel que soit son navigateur. Avec
 * la détection, l'adresse partagée et l'adresse reçue diffèrent, et la seule
 * façon d'imposer le français devient de préfixer `/fr` — ce que le mode
 * `as-needed` existe précisément pour éviter.
 *
 * Et la préférence de langue de cet applicatif n'est pas celle du navigateur :
 * le ticket la place sur `users.locale`, c'est-à-dire sur le **compte**. Un
 * en-tête HTTP ne peut pas la contredire.
 *
 * Conséquence assumée : un anglophone arrivant sur `/` voit le français
 * jusqu'à ce qu'il change de langue. Le sélecteur est là pour ça, et son choix
 * se traduit par une adresse préfixée — donc partageable à son tour.
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "as-needed",
  localeDetection: false,
});
