# Eventini — Architecture frontend

> **Statut :** Spécification normative + état vérifié · **Version :** 1.0 · **Date :** 30 juillet 2026
> **Stack :** Next.js 16.2.12 · React 19.2 · Base UI · Tailwind 4 · TanStack Query 5 · Zustand 5 · Zod 3 · next-intl 4

---

## 1. État vérifié

### 1.1 Ce qui est réellement bon

| Élément | État |
|---|---|
| Kit UI | **63 composants Base UI réels**, générés par shadcn, style `base-luma`. C'est l'actif le plus abouti de tout le dépôt |
| `app-sidebar.tsx` | 558 lignes réelles — navigation, chemin actif, persistance localStorage. **Importé par aucune page** |
| Taxonomie de dossiers | correcte : `features/`, `lib/`, `providers/`, `config/` |
| Client API | fetch + `credentials: "include"` + header CSRF sur les méthodes mutantes — la base est juste |
| Types et schémas d'authentification | réels, cohérents, complets |

### 1.2 Les défauts bloquants

Snapshot du 30 juillet 2026, matin. La colonne **Statut** est mise à jour au fil des tickets ; le reste de la ligne reste le constat d'origine, non réécrit.

| # | Défaut | Conséquence | Statut |
|---|---|---|---|
| **F-1** | **7 fichiers importent `../types`, un barrel qui n'existe pas.** `features/authentication/types/` contient `authentication.types.ts`, `permission.types.ts`, `session.types.ts` — mais **pas d'`index.ts`** | TS2307. Fichiers touchés : `authentication.api.ts`, `mfa.api.ts`, `password.api.ts`, `sessions.api.ts`, `auth-guard.tsx`, `use-permissions.ts`, `authentication.utils.ts` | ✅ **EVT-003** |
| **F-2** | **`AppProviders` n'est monté nulle part.** Il compose correctement `InternationalizationProvider > ThemeProvider > QueryProvider`, et le layout racine ne l'importe pas | Tout `useQuery` lèvera « No QueryClient set » dès qu'une page d'authentification montera un hook | ✅ **EVT-003** |
| **F-3** | **`AuthGuard` déclare `requiredRole` et ne le lit jamais.** Il détructure `{ children }` seulement | `(super-admin)/layout.tsx` passe `requiredRole="SUPER_ADMIN"` — **silencieusement ignoré** | ⏳ EVT-039 (sprint 07) |
| **F-4** | **`middleware.ts` est un pass-through de 7 lignes** — pas de `matcher`, pas de lecture de cookie, pas de redirection. De plus la convention est **dépréciée en Next 16** : le fichier doit devenir `proxy.ts` (§7) | Aucune redirection UX ; s'exécute sur chaque requête pour rien, et fait avertir chaque build | ⏳ EVT-039 (sprint 07) |
| **F-5** | **Base URL par défaut `http://localhost:3000`** — le même port que le backend, et il n'existe aucun `.env` | Le serveur Next s'appelle lui-même. Chaque appel API donne 404 | ⏳ EVT-008/013 (sprint 02) |
| **F-6** | **Pas de retry sur 401.** `refreshSession()` et `useRefreshSession()` existent et **rien ne les appelle** | Une session expirée déconnecte l'utilisateur au lieu de se rafraîchir | ⏳ EVT-038 (sprint 07) |
| **F-7** | **Le corps d'erreur n'est jamais lu.** `throw new ApiError(response.statusText, response.status)` | L'enveloppe RFC 9457 du backend est jetée. `ApiError.details` n'est jamais rempli | ⏳ EVT-037 (sprint 07) — `put`/`patch` déjà ajoutés par EVT-003 |
| **F-8** | **`(public)` et `(scanner)` ne produisent aucune route** — ni `layout.tsx` ni `page.tsx` | Deux groupes de routes fantômes | ✅ **EVT-004** — supprimés, recréés quand scopés |
| **F-9** | **i18n vide** — `messages={{}}`, pas de `locale`, aucun fichier de traduction, pas de plugin dans `next.config.ts`, zéro `useTranslations` | `next-intl` est une dépendance installée avec un wrapper inutilisé | ◐ **EVT-003** a ajouté `locale` (défaut requis par next-intl v4) ; catalogues et plugin restent EVT-047 |
| **F-10** | **Structure dupliquée** — `src/shared/{api,auth,config,hooks,lib,types,ui}` (7 répertoires de `.gitkeep`) double conceptuellement `src/lib` + `src/features` | Deux taxonomies concurrentes | ✅ **EVT-004** |
| **F-11** | **Code mort** — `routes.ts`, `permissions.ts`, `auth-ui.store.ts`, les 4 schémas Zod, `app-sidebar.tsx` : **importés par rien** | Aucun `useForm`, aucun `zodResolver` n'existe dans le dépôt | ⏳ EVT-040/041 (sprint 07) |
| **F-12** | `tsconfig.sidebar-test.tsbuildinfo` (119 Ko) orphelin ; vitest et Playwright installés **sans config ni test ni script** | | ✅ **EVT-004** (fichier) / **EVT-005** (tooling) |

Le proxy sans effet et `AuthGuard` sans logique ne sont **pas** des failles : le frontend n'est jamais une frontière de sécurité (AUTH-INV-011). Ce sont des défauts d'ergonomie. Mais il ne faudra jamais compter dessus pour protéger quoi que ce soit.

---

## 2. Arborescence cible

```
web/src/
├── app/
│   ├── layout.tsx                  ← doit monter <AppProviders>
│   ├── (auth)/                     login, mot de passe, MFA, invitation
│   ├── (admin)/                     tableau de bord, événements, participants, compte
│   ├── (super-admin)/              administration plateforme
│   ├── (scanner)/                  scan web — recréé au sprint 12 (EVT-070)
│   └── (public)/                   pages publiques — recréé quand scopé
├── features/
│   ├── authentication/             api · components · hooks · schemas · stores · types · utils
│   ├── organizations/  events/  event-sessions/  participants/
│   ├── registrations/  tickets/  scanners/  attendance/  reports/
│   └── (chaque feature : api/ components/ hooks/ schemas/ types/ utils/ index.ts)
├── components/
│   ├── ui/                         63 composants Base UI — ne pas modifier à la main
│   └── shared/                     app-sidebar, en-têtes, états vides
├── lib/
│   ├── api/                        client, erreurs, CSRF, refresh single-flight
│   ├── query/                      QueryClient + clés
│   └── permissions/
├── providers/                      AppProviders
├── config/                         routes, permissions, environnement
├── i18n/                           request.ts, routing.ts
├── messages/                       fr.json, en.json
└── proxy.ts             ← `middleware.ts` en Next ≤ 15, renommé en 16
```

`src/shared/` est **supprimé** au sprint 01 (F-10). Deux taxonomies garantissent une répartition arbitraire du code.

> ✅ **F-10 résolu par EVT-004** (30 juillet 2026) : `src/shared/` supprimé, 7 répertoires de `.gitkeep`.
> ✅ **F-8 résolu par EVT-004** : `(public)/` et `(scanner)/` supprimés plutôt que stubbés — aucune route n'existait (ni `layout.tsx` ni `page.tsx`), et fabriquer des pages maintenant aurait anticipé des sprints (12 pour le scanner, non planifié pour le public) sans contenu réel à y mettre. Ils seront recréés avec du contenu véritable quand leur sprint arrive, pas avant.

---

## 3. Frontière serveur / client

| Server Component (défaut) | Client Component (`"use client"`) |
|---|---|
| layouts, pages, chargement de données initial | formulaires, interactivité |
| lecture de cookies pour le rendu | TanStack Query, Zustand |
| aucun secret, aucune décision d'autorisation | aucun accès aux cookies `HttpOnly` |

**Le SSR n'est pas une frontière de sécurité.** Il rejoue les cookies de l'utilisateur ; il n'a aucun privilège propre. Toute donnée qu'il affiche a déjà été autorisée par le backend.

Règle : `"use client"` aussi bas que possible dans l'arbre. Le mettre sur un layout bascule tout le sous-arbre côté client et annule l'intérêt du RSC.

---

## 4. Client API

### 4.1 Ce qu'il doit faire

```ts
const response = await fetch(`${env.apiBaseUrl}${path}`, {
  method,
  credentials: 'include',                       // ← cookies, jamais de token en JS
  headers: {
    ...(isMutating ? { 'X-CSRF-Token': readCsrfCookie() } : {}),
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    ...(ifMatch ? { 'If-Match': ifMatch } : {}),
    'Content-Type': 'application/json',
  },
  body: body ? JSON.stringify(body) : undefined,
});
```

### 4.2 Rafraîchissement en vol unique — corrige F-6

```
401 reçu
  → une rotation déjà en cours ? ATTENDRE sa promesse
  → sinon : POST /auth/sessions/current/rotation, mémoriser la promesse
  → rotation réussie  → rejouer la requête d'origine UNE SEULE FOIS
  → rotation échouée  → purger le cache, rediriger vers /login
```

Trois règles non négociables :

- **une seule tentative** de rotation par requête — un `401 → refresh → 401` en boucle est interdit ;
- **les rotations concurrentes sont dédupliquées** — 10 requêtes recevant `401` simultanément déclenchent **une** rotation, pas dix. Dix rotations concurrentes avec le même refresh token déclencheraient la détection de rejeu et **révoqueraient la session de l'utilisateur** ;
- `POST /auth/sessions` et `POST /auth/sessions/current/rotation` sont **exclus** du retry, sous peine de récursion.

Ce point est le plus subtil du client : sans déduplication, le mécanisme de sécurité du backend déconnecte les utilisateurs légitimes.

### 4.3 Erreurs — corrige F-7

```ts
if (!response.ok) {
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
}
```

`errors[]` alimente directement `setError` de React Hook Form. `requestId` est affiché dans les messages d'erreur techniques : un utilisateur qui signale un problème avec `req_01JABC` permet de retrouver la requête exacte dans les logs.

Méthodes exposées : `get`, `post`, `put`, `patch`, `delete`. `put` et `patch` manquent aujourd'hui alors qu'ils figurent dans `mutatingMethods`.

---

## 5. État

| Propriétaire | Contenu |
|---|---|
| **TanStack Query** | tout l'état serveur — utilisateur courant, sessions, événements, participants, rapports |
| **Zustand** | uniquement l'UI réellement globale — ouverture de modale, étape MFA, état de la sidebar |
| **React Hook Form** | état de formulaire |
| **URL (`nuqs`)** | filtres, tri, pagination — partageables et rechargeables |

**Aucun token dans Zustand, jamais** (AUTH-INV-001). Aucune donnée serveur dans Zustand : elle y deviendrait périmée sans mécanisme d'invalidation.

```ts
export const queryKeys = {
  currentUser: ['auth', 'me'] as const,
  sessions:    ['auth', 'sessions'] as const,
  events:      (filters: EventFilters) => ['events', filters] as const,
  event:       (id: string) => ['events', id] as const,
};
```

Après une mutation qui change le contexte — connexion, déconnexion, changement d'organisation — le cache est **entièrement purgé** (`queryClient.clear()`), pas invalidé. Une invalidation laisserait les données de l'organisation précédente visibles jusqu'au rechargement : une fuite cross-tenant côté client.

---

## 6. Providers — corrige F-2

```tsx
// app/layout.tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
```

`AppProviders` existe déjà et est correct. Il suffit de le monter.

Options par défaut du `QueryClient` (aujourd'hui : `new QueryClient()` sans configuration) :

```ts
{
  queries: {
    staleTime: 30_000,
    retry: (count, error) =>
      error instanceof ApiError && [401, 403, 404].includes(error.status)
        ? false                     // ne jamais réessayer une erreur d'autorisation
        : count < 2,
    refetchOnWindowFocus: false,
  },
}
```

Réessayer un `403` est inutile et bruyant : la permission ne va pas apparaître entre deux tentatives.

---

## 7. Protection de routes

**Le frontend n'est jamais une frontière de sécurité.** Il évite d'afficher une page qui échouera de toute façon.

### `proxy.ts` — corrige F-4

> 🔴 **Ce n'est plus `middleware.ts`.** Next 16 a renommé la convention de fichier en `proxy`, et l'export `middleware` en `proxy`. Le dépôt est sur **Next 16.2.12** et chaque build affiche déjà l'avertissement :
> `⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.`
>
> EVT-039 doit donc créer `src/proxy.ts` et supprimer `src/middleware.ts`, pas remplir ce dernier. Le runtime `edge` n'est **pas** supporté par `proxy` : il s'exécute sous `nodejs`, sans configuration possible.

```ts
// src/proxy.ts
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has('__Host-eventini_access');
  const { pathname } = request.nextUrl;

  if (!hasSession && isProtectedPath(pathname))
    return NextResponse.redirect(new URL('/login', request.url));

  if (hasSession && isAuthPath(pathname))
    return NextResponse.redirect(new URL('/dashboard', request.url));

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
};
```

Le proxy vérifie la **présence** d'un cookie, jamais sa validité — il ne peut pas : le cookie est `HttpOnly` et signé côté serveur. Une redirection est une amélioration d'ergonomie, pas un contrôle.

### `AuthGuard` — corrige F-3

```tsx
export function AuthGuard({ children, requiredRole, requiredPermission }: AuthGuardProps) {
  const { data: user, isLoading, isError } = useCurrentUser();

  if (isLoading) return <AuthGuardSkeleton />;
  if (isError || !user) { redirect('/login'); }
  if (requiredRole && !userHasRole(user, requiredRole)) { redirect('/unauthorized'); }
  if (requiredPermission && !hasPermission(user, requiredPermission)) { redirect('/unauthorized'); }

  return <>{children}</>;
}
```

`userHasRole` et `hasPermission` existent déjà dans `authentication.utils.ts` et `lib/permissions/permission-checker.ts`. Il suffit de les appeler.

Le composant retourne un squelette pendant le chargement, jamais `null` : `null` provoque un flash de contenu vide puis une redirection brutale.

---

## 8. Formulaires

Les 4 schémas Zod existent (`login`, `mfa`, `password`, `invitation`) et ne sont **importés nulle part** (F-11). Aucun `useForm`, aucun `zodResolver` n'existe.

```tsx
const form = useForm<LoginInput>({
  resolver: zodResolver(loginSchema),
  defaultValues: { email: '', password: '' },
});

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

Les erreurs de champ du backend (`error.errors[]`) sont réinjectées dans le formulaire. Les erreurs sans champ deviennent une erreur de formulaire.

**La validation Zod côté client ne remplace jamais la validation backend.** Elle améliore le retour utilisateur ; le backend valide de toute façon.

---

## 9. i18n — corrige F-9

```
web/
├── next.config.ts        → createNextIntlPlugin('./src/i18n/request.ts')
├── src/i18n/
│   ├── routing.ts        locales: ['fr', 'en'], defaultLocale: 'fr'
│   └── request.ts
└── messages/
    ├── fr.json
    └── en.json
```

Stratégie : **préfixe de locale sur les routes non par défaut** (`/en/dashboard`, `/dashboard` pour le français). `users.locale` en base porte la préférence de l'utilisateur connecté.

Locales initiales : `fr` (défaut) et `en`. Le corpus documentaire est en français ([ADR-0001](../adr/0001-documentation-language.md)), le produit est bilingue.

---

## 10. Offline scanner web

`dexie` et `dexie-react-hooks` sont installés et **jamais importés**. Le scanner web offline est prévu au sprint 12.

```
IndexedDB (Dexie)
├── snapshot        tickets valides, sessions ouvertes — durée de validité bornée
├── operations      file d'opérations en attente, chacune avec son operationId
└── syncState       dernière synchronisation, statut
```

Chaque opération porte un `operationId` (ULID) généré localement. À la reconnexion, elles partent en lot vers `POST /events/{id}/attendance-sync`.

**Le client offline n'est jamais l'autorité finale.** Il propose ; le serveur arbitre. Voir [`IDEMPOTENCY_AND_CONCURRENCY.md` §9](../api/IDEMPOTENCY_AND_CONCURRENCY.md).

---

## 11. Temps réel

```ts
const source = new EventSource(`${env.apiBaseUrl}/events/${eventId}/live`,
                               { withCredentials: true });
source.addEventListener('attendance.recorded', (e) => {
  queryClient.setQueryData(queryKeys.eventStats(eventId), JSON.parse(e.data));
});
```

SSE et non WebSocket : le flux est unidirectionnel serveur → tableau de bord. Reconnexion automatique avec backoff exponentiel. Limite de 10 connexions par utilisateur.

---

## 12. Accessibilité et qualité

> **Les tokens, la typographie, l'élévation et le mouvement sont spécifiés dans [`DESIGN_SYSTEM.md`](../design/DESIGN_SYSTEM.md)** ([ADR-0019](../adr/0019-design-system-foundation.md)). Les exigences de contraste AA et de `prefers-reduced-motion` ci-dessous y sont rendues atteignables et vérifiées en navigateur par `web/e2e/design-system.spec.ts`.

Le kit Base UI est accessible par construction. Règles à ne pas casser : navigation clavier complète, focus visible, libellés associés, régions live pour les mises à jour temps réel, contraste AA minimum, `prefers-reduced-motion` respecté.

`dangerouslySetInnerHTML` est **interdit par défaut** (contexte produit §11.6). Toute exception exige un ADR et une désinfection explicite.

---

## 13. Corrections par sprint

| # | Correction | Sprint | Statut |
|---|---|---:|---|
| F-1 | créer `features/authentication/types/index.ts` | 01 | ✅ |
| F-2 | monter `AppProviders` dans le layout racine | 01 | ✅ |
| F-10 | supprimer `src/shared/` | 01 | ✅ |
| F-12 | supprimer le `.tsbuildinfo` orphelin ; configurer vitest et Playwright | 01 | ✅ |
| F-8 | créer ou supprimer `(public)` et `(scanner)` | 01 | ✅ supprimés |
| F-5 | créer `web/.env.example`, port backend distinct (3001) | 02 | |
| F-7 | lire le corps d'erreur, remplir `ApiError` | 07 | |
| F-6 | rotation en vol unique sur 401 | 07 | |
| F-3 | `AuthGuard` applique `requiredRole` et `requiredPermission` | 07 | |
| F-4 | `proxy.ts` avec `matcher` et redirections | 07 | |
| F-11 | brancher schémas Zod, routes, permissions, sidebar | 07 | |
| F-9 | i18n complet | 08 | ◐ `locale` posé par EVT-003 |

**F-1, F-2 et F-5 étaient bloquants** : sans eux, la première page qui montait un hook plantait, et aucun appel API n'aboutissait. F-1 et F-2 sont résolus ; F-5 reste ouvert jusqu'au sprint 02.

### Dépendances

| Paquet | Action | Motif |
|---|---|---|
| `vitest`, `@playwright/test`, `@testing-library/*` | **configurer** | installés, sans config, sans test, sans script |
| `@tanstack/eslint-plugin-query` | **brancher** | installé, absent d'`eslint.config.mjs` |
| `nuqs` | **utiliser** ou retirer | filtres et pagination en URL |
| `dexie` | conserver | offline sprint 12 |
| `libphonenumber-js`, `country-flag-icons` | conserver | formulaire participant sprint 10 |
| Scripts `test`, `type-check`, `format` | **ajouter** | seuls `dev`, `build`, `start`, `lint` existent |
