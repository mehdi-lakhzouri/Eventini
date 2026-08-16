import type { Env } from '../env.schema';
import type { EnvironmentRule } from './rule.types';

/**
 * Les noms de cookies soumis à un préfixe, et l'attribut que chacun exige.
 *
 * `__Host-` impose en plus `Path=/` et l'absence de `Domain` — les deux sont
 * garantis par `cookies.config.ts`, qui écrit `path: '/'` en dur et ne pose
 * jamais de domaine. Seul `Secure` dépend de l'environnement, donc seul
 * `Secure` a besoin d'une règle.
 */
const PREFIXED_COOKIES = [
  'COOKIE_ACCESS_NAME',
  'COOKIE_REFRESH_NAME',
  'COOKIE_CSRF_NAME',
  'COOKIE_CSRF_CONTEXT_NAME',
] as const satisfies readonly (keyof Env)[];

function hasSecurePrefix(name: string): boolean {
  return name.startsWith('__Host-') || name.startsWith('__Secure-');
}

/**
 * Un cookie préfixé exige `Secure`, sinon le navigateur le jette — EVT-078.
 *
 * ## 🔴 Le défaut que cette règle ferme
 *
 * `.env.example` livrait `COOKIE_SECURE=false` avec quatre noms préfixés
 * `__Host-` / `__Secure-`. La spécification des préfixes de cookies impose au
 * navigateur de **refuser** un tel cookie s'il n'a pas l'attribut `Secure` :
 * Chrome les jetait donc tous les quatre, en silence.
 *
 * Conséquence observée : `GET /auth/csrf-token` répondait `200` avec son jeton,
 * le cookie n'était jamais stocké, `document.cookie` restait vide, le client
 * n'envoyait aucun `X-CSRF-Token`, et **toute connexion locale échouait en
 * `403 AUTH_CSRF_INVALID`** — avec des identifiants parfaitement valides.
 *
 * Le symptôme ne désigne pas sa cause : le serveur a raison de refuser, le
 * client a raison de ne rien envoyer, et le seul endroit où quelque chose se
 * perd est un rejet silencieux du navigateur qui n'apparaît dans aucun log,
 * d'aucun côté.
 *
 * ## Pourquoi refuser de démarrer plutôt qu'avertir
 *
 * Parce que le mode de défaillance est total et muet. Une application qui
 * démarre et dont aucune connexion ne peut aboutir est pire qu'une application
 * qui refuse de démarrer en disant pourquoi.
 *
 * ## Les deux façons correctes de configurer un poste local
 *
 * - `COOKIE_SECURE=true` — les navigateurs traitent `http://localhost` comme
 *   une origine sûre et acceptent `Secure` dessus. **C'est le réglage retenu
 *   par `.env.example`** : il garde des noms de cookies identiques en
 *   développement et en production, donc un bug lié au nom ne peut pas
 *   n'apparaître qu'en production.
 * - retirer les préfixes des quatre noms. Fonctionne aussi, mais fait diverger
 *   les noms entre environnements — et le client web tient le nom du cookie
 *   CSRF en dur.
 */
export const cookiePrefixRule: EnvironmentRule = {
  id: '15',
  description: 'Prefixed cookie names require COOKIE_SECURE',

  check(env) {
    if (env.COOKIE_SECURE) {
      return [];
    }

    const offending = PREFIXED_COOKIES.filter((key) =>
      hasSecurePrefix(env[key]),
    );

    if (offending.length === 0) {
      return [];
    }

    return [
      `COOKIE_SECURE=false is incompatible with the __Host-/__Secure- prefix on ${offending.join(', ')}. ` +
        'Browsers silently discard such cookies, so every login fails with AUTH_CSRF_INVALID. ' +
        'Set COOKIE_SECURE=true (browsers accept Secure cookies on http://localhost) or drop the prefixes.',
    ];
  },
};
