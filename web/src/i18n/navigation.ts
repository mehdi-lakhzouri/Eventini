import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

/**
 * Les API de navigation conscientes de la locale — EVT-047.
 *
 * ## 🔴 Pourquoi ne pas garder `next/link` et `useRouter`
 *
 * Sous `localePrefix: "as-needed"`, un `<Link href="/dashboard">` de `next/link`
 * envoie littéralement vers `/dashboard` — donc **vers la version française**,
 * même depuis `/en/organization`. Un anglophone qui clique dans la barre
 * latérale bascule silencieusement en français, et rien ne signale l'erreur :
 * la page existe et s'affiche.
 *
 * Ces enveloppes préfixent le chemin avec la locale courante. Le reste de leur
 * API est identique, ce qui rend la migration mécanique — mais elle n'est pas
 * facultative.
 *
 * `usePathname` d'ici rend le chemin **sans** le préfixe, ce qui est ce que veut
 * un comparateur de route active : `/en/organization` et `/organization` sont
 * la même entrée de menu.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
