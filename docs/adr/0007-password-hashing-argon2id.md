# ADR-0007 — Hachage des mots de passe : Argon2id paramétré + pepper

| | |
|---|---|
| **Statut** | Accepté |
| **Date** | 2026-07-30 |
| **Contradiction résolue** | comble le trou le plus critique du corpus |
| **Impacte** | `user_credentials.password_hash`, `password_version`, login, reset, changement |
| **OWASP** | ASVS V2.4 · Password Storage Cheat Sheet |

## Contexte

Le Document B §26 impose Argon2id et « des paramètres configurables », mais **aucun paramètre n'existe nulle part dans le corpus** — vérifié par `grep` : ni `memoryCost`, ni `timeCost`, ni `parallelism`, ni longueur de sel, ni longueur de hash, ni pepper. La longueur minimale de mot de passe est décrite comme « raisonnable ».

Un développeur ou un agent devrait donc inventer des paramètres de sécurité. Deux implémentations divergeraient silencieusement.

## Décision

**Profil OWASP équilibré, avec pepper serveur.**

```ts
argon2.hash(password, {
  type:        argon2.argon2id,
  memoryCost:  19456,   // KiB = 19 MiB
  timeCost:    2,
  parallelism: 1,
  hashLength:  32,      // octets
  secret:      Buffer.from(env.PASSWORD_PEPPER, 'base64'), // 32 octets
})
// sel : 16 octets aléatoires, générés par la bibliothèque, stockés dans le hash encodé
```

Le pepper utilise l'option **native `secret`** d'Argon2 — pas un HMAC préalable, pas un second niveau de hachage. Il est stocké **hors PostgreSQL** (variable d'environnement, puis gestionnaire de secrets) : un dump de base seul ne permet pas de casser les mots de passe hors ligne.

### Politique de mot de passe

| Règle | Valeur |
|---|---|
| Longueur minimale | 12 caractères |
| Longueur maximale | 128 caractères (borne anti-DoS, pas une contrainte de sécurité) |
| Règles de composition | **aucune** — pas de « une majuscule, un chiffre, un symbole » (ASVS V2.1.9) |
| Normalisation | NFKC avant hachage |
| Espaces | conservés, jamais rognés |
| Liste de mots de passe compromis | prévue, non bloquante au MVP — `DEFERRED`, sprint 12 |

### Versionnement et rehash

`user_credentials.password_version` vaut `1` pour ce profil. À la vérification, si le hash stocké n'utilise pas les paramètres courants, il est **re-haché de façon transparente** dans la même transaction, et `password_version` est incrémenté.

**Rotation du pepper** : elle impose un rehash de tous les mots de passe, impossible sans le mot de passe en clair. La procédure retenue est donc un rehash **opportuniste à la connexion**, avec conservation du pepper précédent pendant la fenêtre de transition, puis expiration forcée des comptes n'ayant pas migré. Documenté dans le runbook, pas dans le chemin nominal.

## Conséquences

**Positives** — 19 MiB × concurrence reste soutenable sur du matériel modeste ; environ 50 à 80 ms par vérification, assez lent pour le cassage hors ligne, assez rapide pour ne pas ouvrir un vecteur de DoS sur `/auth/sessions` ; le pepper protège contre le scénario le plus probable — la fuite de base.

**Négatives** — un secret supplémentaire à provisionner et sauvegarder ; **perdre le pepper rend tous les mots de passe invérifiables**, c'est une donnée de sauvegarde critique, signalée comme telle dans le runbook.

## Alternatives rejetées

- **m=64 MiB, t=3** — plus résistant hors ligne, mais 64 MiB par vérification concurrente fait de l'endpoint de login une cible de DoS mémoire tant que le rate limiting n'est pas en place. Réévaluable après le sprint 05.
- **m=46 MiB, t=1** — même courbe de sécurité OWASP, autre profil de coût. Équivalent, sans avantage décisif.
- **Sans pepper** — un secret de moins à gérer et pas de problème de rotation, au prix de la résistance au dump de base. Le gain de sécurité l'emporte ici.

## Vérification

- Test unitaire : les paramètres effectifs sont ceux déclarés (lecture du hash encodé `$argon2id$v=19$m=19456,t=2,p=1$…`).
- Test unitaire : un hash produit avec d'anciens paramètres est re-haché à la vérification et `password_version` incrémenté.
- Benchmark en CI : la vérification reste sous 150 ms sur le runner, sinon échec (garde-fou contre une régression de paramètre).
