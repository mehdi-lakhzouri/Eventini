<!-- ENTÊTE DE PROVENANCE — ajouté le 30 juillet 2026, contenu d'origine non modifié -->
> ### ⛔ Statut documentaire : `OBSOLÈTE — CONSERVÉ POUR HISTORIQUE UNIQUEMENT`
>
> **Ne pas utiliser ce document pour naviguer dans le dépôt.** Audit du 30 juillet 2026 :
>
> | Affirmation du document | Réalité vérifiée |
> |---|---|
> | La racine backend est `api/` | La racine est **`backend/`**. Il n'existe aucun répertoire `api/`. **Tous** les chemins de ce document sont faux. |
> | « Verification: `api: npm run build → success` » | **Invérifiable** : la branche `master` ne contient **aucun commit**. Il n'existe aucun historique permettant de confirmer un seul des déplacements, suppressions ou conservations décrits ici. |
> | `web/src/app/(auth)/page.tsx`, `(admin)/page.tsx`, `(super-admin)/page.tsx` à supprimer manuellement | Ces fichiers n'existent plus. Section périmée. |
> | Conflit de route `(admin)/dashboard` vs `(super-admin)/dashboard` | Résolu autrement que proposé : `(super-admin)/super-admin/dashboard/page.tsx` existe, `(admin)/dashboard/page.tsx` est resté sur `/dashboard`. Un répertoire `(super-admin)/dashboard/` **vide** subsiste. |
> | `(public)/page.tsx` dans l'arborescence cible | N'existe pas. `(public)` et `(scanner)` ne produisent **aucune route**. |
> | « Not Implemented In This Step » (8 éléments) | Partiellement dépassé : les use cases, guards et specs e2e existent désormais — mais **tous sous forme de classes vides et de `it.todo`**. |
> | Non mentionné | `web/.git` est un **dépôt git imbriqué distinct**. `backend/dist/` est du build committé en arborescence. |
>
> Pour l'état réel du dépôt, voir [`SYSTEM_ARCHITECTURE.md` §3](SYSTEM_ARCHITECTURE.md). Pour l'arborescence cible, voir [`BACKEND_ARCHITECTURE.md`](BACKEND_ARCHITECTURE.md) et [`FRONTEND_ARCHITECTURE.md`](FRONTEND_ARCHITECTURE.md).

---

# Authentication Folder Migration

Date: 2026-07-28

## Scope

This migration prepares the folder architecture for web authentication, session management, CSRF protection, multi-factor authentication, tenant context, identity authorization, invitations, and security events.

No Prisma schema was modified. No secrets, access tokens, refresh tokens, cookie secrets, or cryptographic mock values were added.

## Frontend Structure

```text
web/
├── public/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── favicon.ico
│   │   ├── (public)/
│   │   │   └── page.tsx
│   │   ├── (auth)/
│   │   │   ├── layout.tsx
│   │   │   ├── login/page.tsx
│   │   │   ├── forgot-password/page.tsx
│   │   │   ├── reset-password/page.tsx
│   │   │   ├── verify-mfa/page.tsx
│   │   │   └── accept-invitation/page.tsx
│   │   ├── (admin)/
│   │   │   ├── layout.tsx
│   │   │   ├── dashboard/page.tsx
│   │   │   └── account/
│   │   │       ├── profile/page.tsx
│   │   │       ├── security/page.tsx
│   │   │       └── sessions/page.tsx
│   │   ├── (super-admin)/
│   │   │   ├── layout.tsx
│   │   │   └── dashboard/page.tsx
│   │   └── unauthorized/page.tsx
│   ├── components/
│   │   ├── ui/
│   │   └── shared/
│   ├── config/
│   ├── features/
│   │   └── authentication/
│   │       ├── api/
│   │       ├── components/
│   │       ├── constants/
│   │       ├── hooks/
│   │       ├── schemas/
│   │       ├── stores/
│   │       ├── types/
│   │       ├── utils/
│   │       └── index.ts
│   ├── hooks/
│   ├── lib/
│   │   ├── api/
│   │   ├── permissions/
│   │   ├── query/
│   │   └── utils.ts
│   ├── providers/
│   └── middleware.ts
├── package.json
├── next.config.ts
├── tsconfig.json
└── components.json
```

### Frontend Moved Directories

```text
web/components -> web/src/components
web/hooks      -> web/src/hooks
web/lib        -> web/src/lib
web/app/*      -> web/src/app/*
```

### Frontend Deleted Directories

```text
web/app
```

### Frontend Preserved Files

```text
web/public/*
web/package.json
web/package-lock.json
web/next.config.ts
web/tsconfig.json
web/components.json
web/postcss.config.mjs
web/eslint.config.mjs
web/README.md
```

### Frontend Notes

The API client never reads access or refresh tokens. Mutating requests are prepared to include `X-CSRF-Token` from the readable CSRF cookie only.

Zustand state is limited to authentication UI state in `src/features/authentication/stores/auth-ui.store.ts`.

`next/font/google` was removed from the root layout to avoid build-time network dependency in restricted environments.

## Backend Structure

```text
api/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── modules/
│   │   ├── identity/
│   │   │   ├── identity.module.ts
│   │   │   ├── authentication/
│   │   │   ├── authorization/
│   │   │   ├── csrf/
│   │   │   ├── invitations/
│   │   │   ├── mfa/
│   │   │   ├── passwords/
│   │   │   ├── security-events/
│   │   │   ├── sessions/
│   │   │   ├── tenant-access/
│   │   │   └── index.ts
│   │   ├── event-sessions/
│   │   ├── users/
│   │   ├── organizations/
│   │   ├── events/
│   │   ├── participants/
│   │   ├── registrations/
│   │   ├── attendance/
│   │   ├── scanners/
│   │   ├── qr-credentials/
│   │   ├── notifications/
│   │   ├── realtime/
│   │   ├── reporting/
│   │   ├── audit/
│   │   └── platform-administration/
│   ├── infrastructure/
│   ├── common/
│   ├── config/
│   └── __architecture__/
├── test/
│   ├── authentication/
│   ├── fixtures/
│   ├── helpers/
│   ├── app.e2e-spec.ts
│   └── jest-e2e.json
├── package.json
├── nest-cli.json
├── tsconfig.json
└── tsconfig.build.json
```

### Backend Moved Directories

```text
api/src/modules/sessions -> api/src/modules/event-sessions
api/src/modules/authorization -> api/src/modules/identity/authorization
```

The original `authorization/index.ts` was empty, so no business logic was migrated from that folder.

### Backend Deleted Files And Directories

```text
api/src/modules/authorization
api/src/modules/sessions
api/src/app.controller.ts
api/src/app.service.ts
api/src/app.controller.spec.ts
```

`app.controller.ts`, `app.service.ts`, and `app.controller.spec.ts` only contained the default NestJS "Hello World" demo behavior.

### Backend Preserved Files

```text
api/src/main.ts
api/src/app.module.ts
api/src/modules/users/index.ts
api/src/modules/organizations/index.ts
api/src/modules/events/index.ts
api/src/modules/participants/index.ts
api/src/modules/registrations/index.ts
api/src/modules/attendance/index.ts
api/src/modules/scanners/index.ts
api/src/modules/qr-credentials/index.ts
api/src/modules/notifications/index.ts
api/src/modules/realtime/index.ts
api/src/modules/reporting/index.ts
api/src/modules/audit/index.ts
api/src/modules/platform-administration/index.ts
api/package.json
api/package-lock.json
api/nest-cli.json
api/tsconfig.json
api/tsconfig.build.json
api/README.md
```

## Files Requiring Manual Decision

The following existing frontend route placeholders could not be automatically removed because destructive deletion was blocked by the execution policy:

```text
web/src/app/page.tsx
web/src/app/(auth)/page.tsx
web/src/app/(admin)/page.tsx
web/src/app/(super-admin)/page.tsx
web/src/app/(scanner)/
```

These files contain placeholders or generated demo content, not confirmed business logic. They still create App Router route conflicts.

The requested route shape also includes a Next.js App Router ambiguity:

```text
web/src/app/(admin)/dashboard/page.tsx       -> /dashboard
web/src/app/(super-admin)/dashboard/page.tsx -> /dashboard
```

To compile, these should be changed to concrete route segments such as:

```text
web/src/app/(admin)/admin/dashboard/page.tsx
web/src/app/(super-admin)/super-admin/dashboard/page.tsx
```

## Verification

```text
api: npm.cmd run build
result: success
```

```text
web: npm.cmd run lint
result: success
```

```text
web: npm.cmd run build
result: blocked by App Router route conflicts listed above
```

```text
web/app exists: false
web/src/app exists: true
api/src/modules/authorization exists: false
api/src/modules/identity/authorization exists: true
api/src/modules/sessions exists: false
api/src/modules/event-sessions exists: true
```

Searches found no remaining imports pointing to:

```text
api/src/modules/authorization
api/src/modules/sessions
api/src/app.controller
api/src/app.service
```

## Not Implemented In This Step

The following were intentionally left as skeletons:

```text
authentication use cases
session rotation and revocation behavior
CSRF token generation and validation
password hashing and reset flows
MFA enrollment and verification
tenant resolution
authorization policy evaluation
security event persistence/outbox processing
```
