# Sprint 07 — Frontend authentification

> [← Sprint 06](../sprint-06/README.md) · [Index des sprints](../SPRINT_PLAN.md) · [Sprint 08 →](../sprint-08/README.md)

| | |
|---|---|
| **Tickets** | EVT-037 → EVT-041 |
| **Prérequis** | Sprint 06 |
| **Migrations** | aucune |
| **Parallélisable avec** | Sprint 08 |

---

## Objectif

Connexion depuis le navigateur, session maintenue par rotation automatique, déconnexion effective.

## Critère de sortie

- connexion, maintien de session et déconnexion fonctionnent de bout en bout ;
- **10 requêtes recevant `401` simultanément déclenchent UNE rotation, pas dix.**

---

## Tickets

| # | Titre | Défaut corrigé |
|---|---|---|
| [EVT-037](#evt-037) | Client API — corps d'erreur et méthodes manquantes | F-7 |
| [EVT-038](#evt-038) | Rotation en vol unique sur 401 | F-6 |
| [EVT-039](#evt-039) | Guards de route et **proxy** (ex-middleware) | F-3, F-4 |
| [EVT-040](#evt-040) | Formulaires d'authentification | F-11 |
| [EVT-041](#evt-041) | Gestion de session et contexte d'organisation | — |

Référence des défauts : [`FRONTEND_ARCHITECTURE.md` §1.2](../../architecture/FRONTEND_ARCHITECTURE.md).

---

## EVT-037 — Client API : corps d'erreur et méthodes manquantes
<a id="evt-037"></a>

```
Branche  fix/EVT-037-api-client-errors
Commit   fix(web): parse RFC 9457 error bodies and add put/patch methods
```

### F-7 — le corps d'erreur n'est jamais lu

```ts
// aujourd'hui
throw new ApiError(response.statusText, response.status);
```

L'enveloppe RFC 9457 du backend est **jetée**. `ApiError.details` existe et n'est jamais rempli. Un utilisateur voit « Bad Request » au lieu du message réel, et le formulaire ne peut pas marquer les champs fautifs.

```ts
// cible
const problem = await response.json().catch(() => null);
throw new ApiError({
  status:    response.status,
  code:      problem?.error?.code   ?? 'UNKNOWN_ERROR',
  title:     problem?.error?.title  ?? response.statusText,
  detail:    problem?.error?.detail,
  errors:    problem?.error?.errors ?? [],      // → React Hook Form
  retryable: problem?.error?.retryable ?? false,
  requestId: problem?.meta?.requestId,
});
```

`requestId` est affiché dans les messages d'erreur techniques : un utilisateur qui signale un problème avec `req_01JABC` permet de retrouver la requête exacte dans les logs.

**Autres corrections** — supporter les en-têtes `Idempotency-Key` et `If-Match`.

> ~~ajouter `put` et `patch`~~ — **déjà fait par EVT-003**, vérifié le 14 août 2026 dans `web/src/lib/api/api-client.ts`. Le registre de défauts de [`FRONTEND_ARCHITECTURE.md` §1.2](../../architecture/FRONTEND_ARCHITECTURE.md) le notait, pas ce ticket.

**Base URL** — le défaut `http://localhost:3000` est le port du serveur Next lui-même : sans `.env`, le front s'appelle lui-même et chaque appel donne 404. Corrigé par `PORT=3001` côté backend (EVT-008) et `NEXT_PUBLIC_API_BASE_URL`.

---

## EVT-038 — Rotation en vol unique sur 401
<a id="evt-038"></a>

```
Branche  feat/EVT-038-single-flight-refresh
Commit   feat(web): add single-flight token rotation on 401
```

> **C'est le ticket subtil du sprint.** Une implémentation naïve retourne le mécanisme de sécurité du backend contre l'utilisateur légitime.

### État actuel

`refreshSession()` existe dans `authentication.api.ts`. `useRefreshSession()` existe. **Rien ne les appelle.** Aucun intercepteur, aucune file, aucune déduplication. Une session expirée déconnecte l'utilisateur au lieu de se rafraîchir.

### 🔴 Pourquoi la déduplication est indispensable

Une page de tableau de bord monte 10 requêtes en parallèle. L'access token vient d'expirer. Les 10 reçoivent `401`.

Sans déduplication, les 10 déclenchent une rotation **avec le même refresh token**. La première consomme le token ; les 9 suivantes présentent un token désormais `CONSUMED`. Le backend applique alors exactement ce qu'on lui a demandé de faire : **détection de rejeu, session `COMPROMISED`, famille entière révoquée**.

L'utilisateur est déconnecté par une mesure anti-vol de token, alors que rien n'a été volé.

```
401 reçu
  → une rotation est déjà en cours ? ATTENDRE sa promesse
  → sinon : POST /auth/sessions/current/rotation, mémoriser la promesse
  → succès  → rejouer la requête d'origine UNE SEULE FOIS
  → échec   → queryClient.clear(), rediriger vers /login
```

**Trois règles**

| Règle | |
|---|---|
| **Une seule** tentative de rotation par requête | `401 → refresh → 401` en boucle est interdit |
| Rotations concurrentes **dédupliquées** | une promesse partagée, pas dix appels |
| `POST /auth/sessions` et `.../rotation` **exclus** du retry | sous peine de récursion infinie |

**Tests obligatoires**

- 10 requêtes recevant `401` ⇒ **exactement 1** appel à la route de rotation ;
- rotation échouée ⇒ cache purgé, redirection, **pas de boucle** ;
- une requête ne tente jamais deux rotations.

---

## EVT-039 — Guards de route et proxy
<a id="evt-039"></a>

```
Branche  fix/EVT-039-frontend-route-guards
Commit   fix(web): apply requiredRole in AuthGuard and add the proxy matcher
```

> ### 🔴 Ce ticket ne crée PAS `middleware.ts`
>
> Corrigé le 14 août 2026 (EVT-075). La rédaction d'origine de ce ticket décrivait `middleware.ts`, une convention **dépréciée par Next 16**. Le dépôt est sur **Next 16.2.12** et chaque build affiche déjà :
>
> ```
> ⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.
> ```
>
> | | |
> |---|---|
> | Fichier | `web/src/proxy.ts` — **créer**, et **supprimer** `web/src/middleware.ts` |
> | Export | `export function proxy(request: NextRequest)`, **pas** `middleware` |
> | Runtime | **`nodejs` imposé. Le runtime `edge` n'est PAS supporté par `proxy`**, et cela ne se configure pas |
> | Options `next.config.ts` | renommées : `skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize` |
>
> **Conséquence d'architecture à ne pas manquer.** Sous `middleware`, le code s'exécutait en Edge runtime : démarrage quasi instantané, API Web uniquement, pas d'API Node. Sous `proxy`, il s'exécute en Node.js sur chaque requête correspondant au `matcher`. Le `matcher` cesse donc d'être un détail de performance et devient le levier principal — tout ce qu'il laisse passer paie un aller-retour Node.
>
> Ne pas y remédier laisserait l'implémentation repartir sur une convention obsolète, avec un avertissement à chaque build et une migration forcée à la prochaine montée de version.
>
> Référence : `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`, section « `middleware` to `proxy` ».

### F-3 — `AuthGuard` ignore silencieusement `requiredRole`

Le composant déclare `requiredRole?: Role` dans son type de props et **destructure uniquement `{ children }`**. `(super-admin)/layout.tsx` passe `requiredRole="SUPER_ADMIN"` — la valeur est **silencieusement jetée**.

`userHasRole` existe déjà dans `authentication.utils.ts`. `hasPermission` existe dans `lib/permissions/permission-checker.ts`. Il suffit de les appeler.

Le composant retourne un **squelette** pendant le chargement, jamais `null` : `null` provoque un flash de contenu vide suivi d'une redirection brutale.

### F-4 — le pass-through, et son remplacement

`web/src/middleware.ts` fait 7 lignes : pas de `matcher`, pas de lecture de cookie, pas de redirection. Il s'exécute sur chaque requête pour ne rien faire — et, depuis Next 16, pour faire avertir chaque build.

```ts
// web/src/proxy.ts  ← nouveau fichier ; middleware.ts est supprimé
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has("__Host-eventini_access");
  const { pathname } = request.nextUrl;

  if (!hasSession && isProtectedPath(pathname))
    return NextResponse.redirect(new URL("/login", request.url));

  if (hasSession && isAuthPath(pathname))
    return NextResponse.redirect(new URL("/dashboard", request.url));

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
};
```

Le proxy vérifie la **présence** d'un cookie, jamais sa validité — il ne peut pas : le cookie est `HttpOnly` et signé côté serveur.

`isProtectedPath` et `isAuthPath` se lisent depuis `config/routes.ts`, aujourd'hui importé par rien (défaut **F-11**). Ce ticket est l'occasion de le brancher plutôt que de recopier des listes de chemins.

**Le `matcher` doit exclure `/design-system`** en développement, sinon la recette visuelle redirige vers `/login` et devient inutilisable pour mettre au point l'écran de connexion lui-même.

### 🔴 Rappel

**Le frontend n'est jamais une frontière de sécurité** (AUTH-INV-011). Ces corrections améliorent l'ergonomie — elles évitent d'afficher une page qui échouerait de toute façon. La décision reste entièrement au backend.

---

## EVT-040 — Formulaires d'authentification
<a id="evt-040"></a>

```
Branche  feat/EVT-040-authentication-forms
Commit   feat(web): implement login, MFA and password forms with RHF and Zod
```

**État actuel** — les composants `login-form.tsx`, `forgot-password-form.tsx`, `reset-password-form.tsx`, `mfa-verification-form.tsx` retournent `<form />`. `security-settings.tsx` et `session-list.tsx` retournent `<section />`.

Les **4 schémas Zod existent** (`login`, `mfa`, `password`, `invitation`) et ne sont **importés nulle part**. Aucun `useForm`, aucun `zodResolver` n'existe dans le dépôt.

```tsx
const onSubmit = form.handleSubmit(async (values) => {
  try {
    await login.mutateAsync(values);
    router.push('/dashboard');
  } catch (error) {
    if (error instanceof ApiError) {
      error.errors.forEach(({ field, message }) =>
        form.setError(field as keyof LoginInput, { message }));
      if (error.errors.length === 0)
        form.setError('root', { message: error.title });
    }
  }
});
```

Les erreurs de champ du backend (`error.errors[]`) sont réinjectées dans le formulaire — c'est ce que EVT-037 rend possible.

**Cas à couvrir** — `AUTH_MFA_REQUIRED` ⇒ redirection vers la vérification MFA ; `AUTH_INVALID_CREDENTIALS` ⇒ message générique, **jamais** de détail ; `429` ⇒ afficher `Retry-After`.

**La validation Zod côté client ne remplace jamais la validation backend.** Elle améliore le retour utilisateur ; le backend valide de toute façon.

---

## EVT-041 — Gestion de session et contexte d'organisation
<a id="evt-041"></a>

```
Branche  feat/EVT-041-session-management
Commit   feat(web): add session list, revocation and organization switcher
```

**Scope** — liste des sessions actives, révocation ciblée, déconnexion globale, sélecteur d'organisation.

### 🔴 Purge du cache au changement de contexte

```ts
await activateOrganization(organizationId);
queryClient.clear();          // clear(), PAS invalidateQueries()
```

Une **invalidation** laisserait les données de l'organisation précédente visibles jusqu'au rechargement — une **fuite cross-tenant côté client**. Le backend a bien fait son travail ; c'est le cache navigateur qui trahit.

Même règle après connexion et après déconnexion.

**Autres éléments** — brancher `config/routes.ts` et `config/permissions.ts` (aujourd'hui importés par rien) ; brancher `app-sidebar.tsx` (558 lignes réelles, importé par aucune page) ; navigation adaptée au rôle.

**Options par défaut du `QueryClient`** — aujourd'hui `new QueryClient()` sans configuration :

```ts
retry: (count, error) =>
  error instanceof ApiError && [401, 403, 404].includes(error.status)
    ? false : count < 2,
```

Réessayer un `403` est inutile et bruyant : la permission n'apparaîtra pas entre deux tentatives.

---

## Risques de ce sprint

| Risque | Atténuation |
|---|---|
| **Rotation non dédupliquée ⇒ déconnexions en masse** | Test : 10 × `401` ⇒ 1 seul appel de rotation |
| Boucle `401 → refresh → 401` | Une seule tentative par requête, routes d'auth exclues |
| `invalidateQueries` au lieu de `clear` au changement d'organisation | Test de fuite cross-tenant côté client |
| `AuthGuard` considéré comme une protection réelle | AUTH-INV-011 rappelé ; le backend refuse de toute façon |
| Messages d'erreur trop précis « pour aider » | `AUTH_INVALID_CREDENTIALS` reste générique |
| **EVT-039 implémenté sur `middleware.ts`, convention dépréciée** | Encadré normatif en tête du ticket ; le fichier à créer est `proxy.ts`, l'export `proxy`, et le runtime `edge` n'est pas disponible |
| `matcher` trop large ⇒ chaque requête paie un aller-retour Node | Sous `proxy` le runtime est `nodejs`, plus `edge` : le `matcher` devient un levier de performance, pas un détail |
