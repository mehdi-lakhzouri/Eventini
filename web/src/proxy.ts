import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { isAuthenticationPath, isProtectedPath, routes } from "@/config/routes";
import { localePrefixOf, stripLocalePrefix } from "@/i18n/locale-path";
import { routing } from "@/i18n/routing";

/**
 * Redirections d'ergonomie avant le rendu — EVT-039, étendu par EVT-047.
 *
 * ## Ce fichier s'appelle `proxy.ts`, et pas `middleware.ts`
 *
 * Next 16 a renommé la convention. L'ancien nom fonctionne encore mais fait
 * avertir chaque build, et disparaîtra. Deux conséquences qui ne sont pas de
 * simples renommages :
 *
 * - l'export s'appelle `proxy`, pas `middleware` ;
 * - **le runtime `edge` n'est pas supporté ici.** `proxy` s'exécute sous
 *   Node.js, et cela ne se configure pas. Sous `middleware`, ce code tournait
 *   en Edge — démarrage quasi instantané. Désormais chaque requête admise par
 *   le `matcher` paie un aller-retour Node, ce qui fait du `matcher` le levier
 *   principal et non un détail.
 *
 * ## 🔴 Ce n'est pas une frontière de sécurité
 *
 * AUTH-INV-011. Ce code vérifie la **présence** d'un cookie, jamais sa
 * validité — il ne le peut pas : le cookie est `HttpOnly`, signé côté serveur,
 * et sa vérification demande la clé et la base. Un cookie expiré, révoqué ou
 * fabriqué passe donc ici sans encombre.
 *
 * ## 🔴 L'ordre : authentification d'abord, locale ensuite
 *
 * Les deux middlewares veulent répondre à la même requête, et l'ordre change le
 * résultat.
 *
 * `next-intl` d'abord signifierait que `/en/dashboard` sans session serait
 * d'abord réécrit, puis redirigé — deux sauts au lieu d'un, et le second
 * perdrait la locale au passage.
 *
 * L'authentification d'abord permet de construire une destination **dans la
 * langue de l'appelant** : un anglophone déconnecté sur `/en/organization`
 * atterrit sur `/en/login`, pas sur `/login`. Sans ce soin, chaque expiration
 * de session ramènerait les anglophones en français, et le retour vers `next`
 * les y laisserait.
 */
const ACCESS_COOKIE = "__Host-eventini_access";

const handleLocale = createIntlMiddleware(routing);

export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has(ACCESS_COOKIE);
  const { pathname } = request.nextUrl;

  /*
    Le chemin est comparé **sans** son préfixe de locale. `isProtectedPath`
    énumère `/login`, `/dashboard`… : lui donner `/en/login` le classerait
    comme protégé, puisqu'il ne figure pas dans la liste des chemins publics.

    Le mode de défaillance serait discret et pénible : un anglophone
    déconnecté serait renvoyé vers la connexion depuis l'écran de connexion.
  */
  const prefix = localePrefixOf(pathname);
  const path = stripLocalePrefix(pathname);

  if (!hasSession && isProtectedPath(path)) {
    const target = new URL(`${prefix}${routes.login}`, request.url);

    /*
      La destination voulue est conservée pour qu'EVT-040 y ramène après
      connexion. Seuls le chemin et la query sont repris — `request.url` est
      absolu, et le recopier entier permettrait de faire rebondir un
      utilisateur vers un domaine tiers après authentification.

      Le chemin conservé garde son préfixe : c'est là que l'utilisateur
      voulait aller, dans la langue où il le voulait.
    */
    target.searchParams.set("next", `${pathname}${request.nextUrl.search}`);

    return NextResponse.redirect(target);
  }

  if (hasSession && isAuthenticationPath(path)) {
    return NextResponse.redirect(
      new URL(`${prefix}${routes.adminDashboard}`, request.url),
    );
  }

  /*
    Rien à rediriger côté session : `next-intl` prend la main. C'est lui qui
    négocie la locale à la racine, pose le cookie de préférence et réécrit vers
    le segment `[locale]`. Renvoyer `NextResponse.next()` ici court-circuiterait
    tout cela et laisserait le segment non résolu.
  */
  return handleLocale(request);
}

export const config = {
  /*
    Tout sauf les ressources statiques et les routes d'API.

    Chaque chemin admis coûte une exécution Node depuis Next 16 : exclure
    `_next/static`, `_next/image` et les fichiers d'icônes n'est pas une
    micro-optimisation, c'est ce qui évite d'interposer un serveur devant
    chaque fragment de bundle.
  */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|api).*)",
  ],
};
