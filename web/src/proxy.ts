import { NextResponse, type NextRequest } from "next/server";

import { isAuthenticationPath, isProtectedPath, routes } from "@/config/routes";

/**
 * Redirections d'ergonomie avant le rendu — EVT-039, corrige F-4.
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
 * Ce que cela apporte est réel mais modeste : éviter d'afficher une page qui
 * échouerait de toute façon. La décision reste entièrement au backend, qui
 * refusera la requête de données que la page émettra.
 */
const ACCESS_COOKIE = "__Host-eventini_access";

export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has(ACCESS_COOKIE);
  const { pathname } = request.nextUrl;

  if (!hasSession && isProtectedPath(pathname)) {
    const target = new URL(routes.login, request.url);

    /*
      La destination voulue est conservée pour qu'EVT-040 y ramène après
      connexion. Seuls le chemin et la query sont repris — `request.url` est
      absolu, et le recopier entier permettrait de faire rebondir un
      utilisateur vers un domaine tiers après authentification.
    */
    target.searchParams.set("next", `${pathname}${request.nextUrl.search}`);

    return NextResponse.redirect(target);
  }

  if (hasSession && isAuthenticationPath(pathname)) {
    return NextResponse.redirect(new URL(routes.adminDashboard, request.url));
  }

  return NextResponse.next();
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
