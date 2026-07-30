<!-- ENTÊTE DE PROVENANCE — ajouté le 30 juillet 2026, contenu d'origine non modifié -->
> ### 🔖 Statut documentaire : `CANONIQUE — DÉPLACÉ, PARTIELLEMENT SUPERSÉDÉ`
>
> Ce document est déplacé au chemin qu'il recommandait lui-même. Il reste la **source canonique** du périmètre produit, des acteurs, des états métier, des workflows et de la Definition of Done (§19).
>
> | Section | Statut |
> |---|---|
> | §13.3 / §13.4 enveloppes de succès et d'erreur | **Supersédé** par [`API_CONVENTIONS.md`](../api/API_CONVENTIONS.md) — l'enveloppe retenue est RFC 9457, voir [ADR-0008](../adr/0008-response-envelope-rfc9457.md) |
> | §13.2 familles de routes | **Précisé** par [`API_CONVENTIONS.md` §4](../api/API_CONVENTIONS.md) — les segments verbaux deviennent des sous-ressources, voir [ADR-0010](../adr/0010-auth-route-naming.md) |
> | §14 modèle de données conceptuel | **Remplacé** par [`DATABASE_SCHEMA.md`](../database/DATABASE_SCHEMA.md) — 30 tables définies au lieu de listes indicatives |
> | §17 état réel du dépôt | **Confirmé et chiffré** par [`SYSTEM_ARCHITECTURE.md` §3](../architecture/SYSTEM_ARCHITECTURE.md) — l'audit du 30 juillet 2026 valide chaque constat de cette section et y ajoute des mesures |
> | §18 ordre chronologique | **Réconcilié** avec les 3 autres séquences concurrentes dans [`IMPLEMENTATION_ROADMAP.md`](../sprints/IMPLEMENTATION_ROADMAP.md) |
> | §19 Definition of Done | **Normatif, inchangé** — repris tel quel dans [`.github/pull_request_template.md`](../../.github/pull_request_template.md) |
>
> Point d'entrée de toute la documentation : [`PROJECT_DOCUMENTATION_INDEX.md`](../PROJECT_DOCUMENTATION_INDEX.md).

---

# Eventini — Contexte Produit, Périmètre Métier et Cadre d’Implémentation

> **Nom recommandé dans le dépôt :** `docs/00-project-context/EVENTINI_PROJECT_CONTEXT.md`  
> **Statut :** document de référence canonique  
> **Dernière mise à jour :** 30 juillet 2026  
> **Audience :** développeurs, architectes, agents IA, reviewers, QA, DevSecOps et chefs de projet

---

## 1. Objectif de ce document

Ce document décrit la vision cible, le périmètre fonctionnel, les règles métier, les acteurs, les frontières de sécurité, les principes d’architecture et l’ordre d’implémentation du SaaS **Eventini**.

Il doit empêcher les dérives suivantes :

- confondre les dossiers existants avec des fonctionnalités réellement terminées ;
- inventer des règles métier non validées ;
- implémenter les modules dans le mauvais ordre ;
- contourner le multi-tenant ou l’autorisation scoped ;
- mettre de la logique métier dans les controllers, composants UI ou middlewares ;
- utiliser Redis comme source de vérité métier ;
- construire le scanner mobile avant que les contrats backend soient stables ;
- présenter une feature comme terminée sans tests, migration, intégration et preuve d’exécution.

Ce document est une **source de contexte produit et architecture**, mais il ne remplace pas :

- le code source ;
- les migrations ;
- les contrats API ;
- les ADR ;
- les spécifications détaillées de chaque module ;
- les tests automatisés ;
- les décisions explicitement validées ultérieurement.

Lorsqu’il existe un conflit :

1. une décision récente et explicitement validée prime ;
2. une ADR acceptée prime sur une convention générale ;
3. le code et les migrations décrivent l’état réel ;
4. ce document décrit l’intention cible.

---

# 2. Résumé exécutif

**Eventini** est un SaaS multi-tenant de gestion d’événements et de contrôle d’accès. Il permet à une organisation cliente de préparer ses événements, structurer les sessions, importer ou inscrire les participants, générer des moyens d’accès sécurisés, affecter des scanners et suivre les check-ins en temps réel, y compris lorsque la connectivité est limitée.

La plateforme distingue trois acteurs principaux :

- `SUPER_ADMIN` : administration globale de la plateforme ;
- `CLIENT_ADMIN` : administration d’une organisation et de ses événements ;
- `SCANNER` : exécution opérationnelle du check-in et du check-out sur un périmètre affecté.

Le produit doit être conçu comme un **monolithe modulaire**, avec :

- frontend web en Next.js ;
- backend API en NestJS ;
- PostgreSQL comme source de vérité ;
- Redis pour les états temporaires, le cache, le rate limiting, l’anti-replay et les queues ;
- BullMQ pour les traitements asynchrones ;
- application scanner mobile Flutter à une phase ultérieure ;
- observabilité structurée avec Pino, health checks et métriques ;
- sécurité multi-tenant stricte et authorization scoped côté backend.

L’objectif n’est pas seulement de construire une interface de check-in. Eventini doit fournir une plateforme cohérente, auditée et exploitable en production, depuis la création d’une organisation jusqu’au reporting final d’un événement.

---

# 3. Problème métier traité

Les organisateurs d’événements rencontrent généralement plusieurs difficultés :

- données participants dispersées entre fichiers, formulaires et outils différents ;
- difficulté à contrôler les droits des administrateurs et opérateurs ;
- lenteur du check-in lorsque le volume augmente ;
- absence de visibilité temps réel sur la fréquentation ;
- risques de doublon, fraude, QR code partagé ou check-in répété ;
- difficulté à gérer plusieurs sessions ou plusieurs jours ;
- connexion réseau instable sur le lieu de l’événement ;
- faible traçabilité des opérations sensibles ;
- exports et rapports produits manuellement ;
- incapacité à suspendre rapidement un événement, un scanner ou une organisation.

Eventini centralise ces besoins dans un SaaS multi-tenant avec des frontières d’accès explicites.

---

# 4. Vision produit

Eventini doit permettre le cycle complet suivant :

1. la plateforme crée ou active une organisation cliente ;
2. l’organisation configure ses membres et leurs droits ;
3. un administrateur crée un événement ;
4. l’événement est découpé en jours, sessions, panels ou workshops ;
5. les participants sont enregistrés manuellement, importés ou préinscrits ;
6. les inscriptions sont validées et associées aux accès autorisés ;
7. des tickets ou QR codes sécurisés sont générés ;
8. des appareils ou comptes scanner sont affectés à un événement ou une session ;
9. les opérateurs réalisent les check-ins et éventuellement les check-outs ;
10. les interfaces administratives sont mises à jour en temps réel ;
11. les opérations offline sont synchronisées de manière idempotente ;
12. les administrateurs consultent les rapports, exports, anomalies et journaux ;
13. l’événement est clôturé, expiré ou annulé ;
14. les données sont conservées conformément aux règles de sécurité et de rétention.

---

# 5. Principes directeurs

## 5.1 Backend autoritaire

Le backend est la seule autorité pour :

- l’identité ;
- les rôles ;
- les permissions ;
- le tenant actif ;
- les affectations événementielles ;
- la validité d’un QR code ;
- l’autorisation d’un check-in ;
- les états d’une organisation, d’un événement ou d’une session ;
- l’idempotence ;
- les décisions de sécurité.

Le frontend peut masquer une action pour améliorer l’UX, mais ne doit jamais être considéré comme une frontière de sécurité.

## 5.2 PostgreSQL comme source de vérité

PostgreSQL contient les données durables :

- utilisateurs ;
- organisations ;
- memberships ;
- rôles et permissions ;
- événements ;
- sessions ;
- participants ;
- inscriptions ;
- tickets ;
- scanners ;
- check-ins ;
- journaux d’audit ;
- événements de sécurité ;
- sessions utilisateur et révocations nécessaires.

Redis ne doit pas devenir la source de vérité métier.

## 5.3 Redis pour les états temporaires

Redis peut être utilisé pour :

- rate limiting ;
- lockout temporaire ;
- cache de session ;
- anti-replay ;
- idempotency cache ;
- présence temps réel ;
- challenges MFA temporaires ;
- files BullMQ ;
- verrous courts ;
- déduplication temporaire ;
- accélération des lectures fréquentes.

Toute perte Redis doit être traitée explicitement. Elle ne doit pas supprimer les données métier durables.

## 5.4 Fail closed

Lorsqu’une condition de sécurité ne peut pas être vérifiée, le système refuse l’action.

Exemples :

- membership introuvable ;
- tenant non résolu ;
- événement suspendu ;
- scanner non affecté ;
- QR illisible ou signature non valide ;
- permissions non chargées ;
- session utilisateur révoquée ;
- conflit d’idempotency key ;
- dépendance de sécurité indisponible sans stratégie de repli sûre.

## 5.5 Idempotence

Les actions répétables ou susceptibles d’être rejouées doivent être idempotentes, notamment :

- check-in ;
- synchronisation offline ;
- création depuis un client mobile instable ;
- import de participants ;
- génération d’exports ;
- exécution de jobs ;
- traitement de webhooks futurs ;
- commandes déclenchées plusieurs fois par timeout réseau.

## 5.6 Auditabilité

Toute action sensible doit produire une trace exploitable :

- acteur ;
- organisation ;
- événement ;
- ressource ;
- action ;
- résultat ;
- timestamp ;
- request ID ;
- contexte utile ;
- ancienne et nouvelle valeur lorsque pertinent ;
- motif de refus ou de changement ;
- provenance du client.

Les secrets ne doivent jamais être enregistrés dans les logs.

---

# 6. Acteurs et périmètres

## 6.1 SUPER_ADMIN

### Portée

Globale, au niveau plateforme.

### Responsabilités

- créer, activer, suspendre ou désactiver une organisation ;
- gérer la configuration globale ;
- superviser les licences ou plans ;
- consulter les métriques globales ;
- consulter les journaux globaux selon les règles d’accès ;
- gérer les administrateurs de plateforme ;
- intervenir en cas d’incident ;
- activer un mécanisme de kill-switch ;
- suspendre un événement ou une organisation ;
- contrôler la santé globale des services ;
- déclencher des opérations de support strictement auditées.

### Contraintes

- les opérations doivent être fortement auditées ;
- l’accès global ne signifie pas absence de contrôle ;
- les actions critiques peuvent exiger une réauthentification ou MFA ;
- l’impersonation, si elle est un jour ajoutée, doit être explicitement conçue, limitée et auditée ;
- un super admin ne doit pas utiliser les mêmes routes métier qu’un client admin sans contexte clair.

## 6.2 CLIENT_ADMIN

### Portée

Une organisation, éventuellement limitée à certains événements.

### Responsabilités

- gérer les membres de son organisation ;
- gérer les invitations ;
- créer et configurer des événements ;
- gérer les sessions ;
- gérer les participants et inscriptions ;
- importer et exporter des données ;
- affecter des scanners ;
- consulter l’activité et les rapports ;
- gérer les paramètres autorisés de l’organisation ;
- examiner les anomalies de check-in ;
- fermer ou annuler un événement selon ses permissions.

### Contraintes

- aucune lecture ou écriture hors de son organisation ;
- les affectations événementielles peuvent réduire davantage son périmètre ;
- une permission de niveau organisation ne doit pas automatiquement donner l’accès à tous les événements si le modèle retenu limite certains membres.

## 6.3 SCANNER

### Portée

Un événement ou un ensemble restreint de sessions.

### Responsabilités

- activer son contexte scanner ;
- scanner ou saisir un code autorisé ;
- consulter le résultat de validation ;
- effectuer un check-in ;
- effectuer un check-out si le workflow le prévoit ;
- synchroniser les opérations offline ;
- voir seulement les informations strictement nécessaires à l’opération.

### Contraintes

- aucune administration d’organisation ;
- aucune gestion globale des participants ;
- aucune modification libre de l’événement ;
- accès limité aux événements et sessions affectés ;
- appareil ou session scanner révocable ;
- capacité offline bornée par une politique de synchronisation et de sécurité ;
- affichage minimal des données personnelles.

## 6.4 Participant

Le participant n’est pas nécessairement un utilisateur authentifié de la plateforme.

Il peut :

- être importé ;
- être créé manuellement ;
- être préinscrit ;
- recevoir une invitation ou un ticket ;
- être associé à une ou plusieurs sessions ;
- présenter un QR code ;
- recevoir des emails transactionnels.

La création d’un compte participant complet est hors du cœur initial, sauf décision produit ultérieure.

---

# 7. Modèle multi-tenant

## 7.1 Tenant principal

L’`Organization` est le tenant principal.

Les données suivantes appartiennent directement ou indirectement à une organisation :

- memberships ;
- événements ;
- sessions ;
- participants ;
- inscriptions ;
- tickets ;
- scanners ;
- affectations ;
- check-ins ;
- rapports ;
- notifications ;
- audit métier.

## 7.2 Membership

Le lien entre un utilisateur et une organisation est représenté par un membership.

Un membership possède notamment :

- un utilisateur ;
- une organisation ;
- un statut ;
- des rôles ou permissions ;
- des dates d’activation, suspension ou révocation ;
- un contexte de création ;
- éventuellement des restrictions événementielles.

Un utilisateur peut appartenir à plusieurs organisations. Ses droits doivent être recalculés selon l’organisation active.

## 7.3 Autorisation scoped

Les droits peuvent exister à plusieurs niveaux :

- plateforme ;
- organisation ;
- événement ;
- session ;
- ressource.

Exemple :

- un utilisateur peut être `CLIENT_ADMIN` dans l’organisation A ;
- être simple analyste dans l’organisation B ;
- être autorisé uniquement sur l’événement X de l’organisation B ;
- ne posséder aucun droit sur l’événement Y.

Le backend doit donc résoudre :

1. l’identité ;
2. la session ;
3. le tenant actif ;
4. le membership ;
5. le rôle ;
6. les permissions ;
7. le scope de la ressource ;
8. l’état de la ressource.

---

# 8. États métier principaux

## 8.1 Organization

États cibles :

- `ACTIVE`
- `SUSPENDED`
- `KILLED`

### Règles

- `ACTIVE` : usage normal ;
- `SUSPENDED` : accès métier bloqué ou fortement limité ;
- `KILLED` : arrêt d’urgence, toutes les opérations métier refusées sauf opérations explicitement prévues de récupération ou support.

Un champ de type `isEnabled` ne doit pas remplacer un vrai état métier si plusieurs transitions sont nécessaires.

## 8.2 Event

États cibles :

- `DRAFT`
- `ACTIVE`
- `EXPIRED`
- `CANCELLED`

### Règles

- `DRAFT` : préparation, pas de check-in public ;
- `ACTIVE` : opérations autorisées selon les fenêtres de temps et sessions ;
- `EXPIRED` : événement terminé automatiquement ou manuellement ;
- `CANCELLED` : événement annulé, accès refusé sauf consultation autorisée.

## 8.3 Session

États cibles :

- `SCHEDULED`
- `OPEN`
- `CLOSED`

### Règles

- `SCHEDULED` : préparée mais check-in non ouvert ;
- `OPEN` : check-in autorisé ;
- `CLOSED` : check-in bloqué.

Une session peut correspondre à :

- une journée ;
- un panel ;
- un workshop ;
- un atelier ;
- un accès particulier ;
- une salle ou zone ;
- une séquence horaire.

## 8.4 Membership

États à formaliser dans la spécification du module, au minimum :

- invité ou pending ;
- actif ;
- suspendu ;
- révoqué ;
- expiré si applicable.

## 8.5 User session

États possibles :

- active ;
- expirée ;
- révoquée ;
- compromise ;
- rotated.

---

# 9. Domaines fonctionnels

## 9.1 Platform Administration

Fonctionnalités cibles :

- gestion des organisations ;
- gestion des administrateurs plateforme ;
- activation/suspension/kill-switch ;
- métriques globales ;
- santé des services ;
- journaux de sécurité globaux ;
- configuration de plans ou licences ;
- limites d’usage ;
- opérations de support auditées.

## 9.2 Identity and Access Management

Sous-domaines :

- utilisateurs ;
- credentials ;
- authentification ;
- sessions ;
- refresh token rotation ;
- logout ;
- password reset ;
- vérification email si retenue ;
- MFA/TOTP ;
- invitations ;
- memberships ;
- rôles ;
- permissions ;
- tenant access ;
- authorization scoped ;
- événements de sécurité.

## 9.3 Organizations

Fonctionnalités :

- création ;
- activation ;
- configuration ;
- membres ;
- invitations ;
- rôles ;
- statut ;
- branding futur ;
- paramètres métier ;
- limites de plan.

## 9.4 Events

Fonctionnalités :

- création ;
- mise à jour ;
- publication ou activation ;
- annulation ;
- expiration ;
- configuration multi-jour ;
- fenêtres de check-in ;
- affectation d’administrateurs ;
- affectation de scanners ;
- règles d’accès.

## 9.5 Sessions

Fonctionnalités :

- création ;
- planification ;
- ouverture ;
- fermeture ;
- panels ;
- workshops ;
- zones ;
- capacité si nécessaire ;
- accès participant par session ;
- check-in distinct par session.

## 9.6 Participants

Fonctionnalités :

- création manuelle ;
- import CSV/Excel ;
- normalisation ;
- détection de doublons ;
- recherche ;
- édition ;
- archivage ;
- segmentation ;
- types spécifiques ;
- minimisation des données personnelles.

Types métier déjà envisagés :

- participant normal ;
- bénéficiaire travel grant ;
- ambassadeur pouvant être lié à ses propres actions et, selon règles futures, à des pairs.

Les règles de points ou de parrainage doivent être documentées séparément avant implémentation.

## 9.7 Registrations

Fonctionnalités :

- préinscription ;
- inscription ;
- validation ;
- annulation ;
- affectation à des sessions ;
- statut ;
- origine de l’inscription ;
- contrôle des doublons ;
- historique.

## 9.8 Tickets et QR Codes

Fonctionnalités :

- génération ;
- association à une inscription ;
- révocation ;
- expiration ;
- rotation ou régénération ;
- vérification d’intégrité ;
- limitation du rejeu ;
- distinction entre identifiant public et données internes.

Un QR code ne doit pas exposer directement des données personnelles ou un identifiant séquentiel exploitable.

## 9.9 Scanner Devices et Scanner Access

Fonctionnalités :

- enregistrement d’un appareil ;
- activation ;
- affectation à une organisation ;
- affectation à un événement ;
- limitation à des sessions ;
- révocation ;
- dernière activité ;
- version de l’application ;
- état de synchronisation ;
- capacités offline ;
- preuve d’identité de l’appareil selon le niveau de sécurité retenu.

## 9.10 Attendance

Fonctionnalités :

- check-in ;
- check-out optionnel ;
- check-in par événement ;
- check-in par session ;
- refus explicite avec raison ;
- idempotence ;
- détection de doublon ;
- trace de l’opérateur ;
- trace de l’appareil ;
- horodatage serveur ;
- horodatage client conservé comme information non autoritaire ;
- synchronisation offline ;
- résolution de conflits ;
- anomalies et revue.

## 9.11 Realtime

Objectifs :

- mettre à jour les compteurs sans rafraîchir ;
- afficher les derniers check-ins ;
- signaler les anomalies ;
- suivre les scanners actifs ;
- suivre l’état de synchronisation.

Choix initial recommandé :

- SSE pour les flux principalement serveur vers dashboard ;
- Socket.IO seulement lorsque la bidirectionnalité ou les rooms avancées sont réellement nécessaires.

## 9.12 Notifications

Canaux initiaux :

- email transactionnel.

Emails possibles :

- invitation organisation ;
- invitation utilisateur ;
- création de compte ;
- vérification email ;
- reset password ;
- confirmation de changement de mot de passe ;
- activation MFA ;
- désactivation MFA ;
- connexion suspecte ;
- révocation de session ;
- invitation événement ;
- ticket ou QR code ;
- rappel événement ;
- événement annulé ;
- alertes administratives.

Les emails doivent être traités de manière asynchrone via BullMQ avec retry maîtrisé.

## 9.13 Reporting

Fonctionnalités :

- participants inscrits ;
- participants présents ;
- taux de présence ;
- check-ins par période ;
- check-ins par session ;
- anomalies ;
- activité scanners ;
- exports CSV/Excel ;
- rapports par organisation ;
- rapports par événement.

## 9.14 Audit et Security Events

### Audit logs

Ils décrivent les actions métier et administratives :

- qui ;
- quoi ;
- sur quelle ressource ;
- avant/après ;
- dans quelle organisation ;
- résultat ;
- motif ;
- request ID.

### Security events

Ils décrivent les événements liés à la sécurité :

- échecs de connexion ;
- lockout ;
- refresh token reuse ;
- session compromise ;
- CSRF refusé ;
- tenant mismatch ;
- permission refusée ;
- QR invalide ;
- replay ;
- scanner révoqué ;
- tentative hors scope.

---

# 10. Workflows métier majeurs

## 10.1 Création d’une organisation

1. un super admin crée l’organisation ;
2. la plateforme valide les paramètres ;
3. l’organisation est créée dans un état défini ;
4. un premier client admin est invité ou assigné ;
5. un audit log est créé ;
6. un email d’invitation est mis en queue ;
7. l’organisation devient exploitable après activation.

## 10.2 Invitation d’un client admin

1. un acteur autorisé saisit l’email ;
2. le backend vérifie tenant, permission et doublons ;
3. une invitation à durée limitée est créée ;
4. le token est généré de manière sécurisée et stocké hashé ;
5. l’email est envoyé par job ;
6. le destinataire accepte ;
7. un utilisateur est créé ou associé ;
8. le membership devient actif ;
9. le rôle est assigné ;
10. l’action est auditée.

## 10.3 Création d’un événement

1. un client admin authentifié choisit son organisation active ;
2. le backend vérifie membership et permission ;
3. l’événement est créé en `DRAFT` ;
4. les jours et sessions sont ajoutés ;
5. les fenêtres de check-in sont configurées ;
6. les administrateurs/scanners sont affectés ;
7. l’événement est activé lorsque les préconditions sont satisfaites ;
8. chaque transition est auditée.

## 10.4 Import de participants

1. upload du fichier ;
2. validation du type et de la taille ;
3. parsing sécurisé ;
4. normalisation ;
5. validation des colonnes ;
6. détection de doublons ;
7. prévisualisation ;
8. confirmation ;
9. import transactionnel ou par batch ;
10. rapport des lignes acceptées/rejetées ;
11. génération éventuelle des inscriptions ;
12. audit.

## 10.5 Génération d’un ticket

1. inscription valide ;
2. événement actif ou éligible ;
3. génération d’un identifiant non prédictible ;
4. construction d’un token ou payload signé ;
5. stockage du hash ou des métadonnées nécessaires ;
6. génération QR ;
7. envoi asynchrone ;
8. capacité de révocation et régénération ;
9. audit.

## 10.6 Activation scanner

1. l’opérateur s’authentifie ou utilise le mécanisme scanner prévu ;
2. il fournit un `eventCode` ou sélectionne une affectation ;
3. le backend vérifie le scanner, l’utilisateur, l’organisation et l’événement ;
4. un contexte scanner borné est créé ;
5. les sessions autorisées sont chargées ;
6. les données offline minimales sont synchronisées ;
7. l’appareil est marqué actif ;
8. les opérations restent révocables.

## 10.7 Check-in online

1. scan du QR code ;
2. décodage local minimal ;
3. envoi au backend avec idempotency key ;
4. validation de l’identité scanner ;
5. validation tenant/event/session ;
6. validation du QR ;
7. validation de l’état event/session ;
8. contrôle du doublon ;
9. création atomique du check-in ;
10. publication d’un événement realtime ;
11. réponse structurée ;
12. audit et métriques.

## 10.8 Check-in offline

1. l’appareil dispose d’un snapshot limité et chiffré si nécessaire ;
2. le scan produit une opération locale ;
3. chaque opération reçoit un identifiant unique ;
4. l’application empêche les doublons locaux ;
5. les opérations sont stockées dans IndexedDB/SQLite selon le client ;
6. à la reconnexion, un batch est envoyé ;
7. le backend traite chaque opération de façon idempotente ;
8. les conflits sont classés ;
9. les résultats sont renvoyés ;
10. le client marque chaque opération synchronisée ou en erreur ;
11. les anomalies restent visibles pour revue.

Le client offline ne devient jamais l’autorité finale.

## 10.9 Clôture d’un événement

1. fermeture des sessions ;
2. arrêt des nouveaux check-ins ;
3. synchronisation des scanners ;
4. traitement des opérations en attente ;
5. génération des rapports ;
6. révocation des contextes scanner ;
7. passage de l’événement à `EXPIRED` ;
8. conservation des données selon politique ;
9. audit final.

---

# 11. Règles de sécurité

## 11.1 Authentification web

Approche cible :

- access token de courte durée ;
- refresh token à rotation ;
- cookies `HttpOnly` ;
- `Secure` en production ;
- `SameSite` adapté ;
- protection CSRF ;
- révocation de session ;
- détection de réutilisation d’un refresh token ;
- Argon2id pour les mots de passe ;
- MFA TOTP pour les comptes sensibles ;
- re-authentication pour opérations critiques.

## 11.2 CSRF

Le frontend et le backend doivent implémenter un mécanisme cohérent :

- endpoint d’obtention du token ;
- cookie CSRF lisible si double-submit retenu ;
- header `X-CSRF-Token` ;
- validation sur les méthodes mutantes ;
- vérification Origin ;
- refus explicite ;
- tests positifs et négatifs.

## 11.3 Protection contre brute force

Minimum :

- rate limit par IP ;
- rate limit par identifiant ;
- délai ou lockout progressif ;
- logs de sécurité ;
- réponses ne révélant pas l’existence d’un compte ;
- politique de déverrouillage ;
- métriques et alertes.

## 11.4 IDOR et BOLA

Chaque accès à une ressource doit vérifier :

- ownership tenant ;
- membership ;
- permission ;
- affectation ;
- état ;
- scope précis.

Ne jamais faire confiance à un `organizationId`, `eventId` ou `userId` venant du client sans revalidation.

## 11.5 SQL injection

Prisma ou requêtes paramétrées doivent être utilisés.

Les requêtes raw :

- sont exceptionnelles ;
- sont paramétrées ;
- sont revues ;
- sont testées ;
- n’acceptent jamais de fragment SQL fourni par le client.

## 11.6 XSS

- React ne doit pas être contourné sans nécessité ;
- `dangerouslySetInnerHTML` est interdit par défaut ;
- les emails/templates doivent échapper les données ;
- les imports ne doivent pas injecter de HTML ;
- une CSP doit être définie ;
- les URLs externes doivent être validées.

## 11.7 QR code

Le QR code doit résister à :

- prédiction ;
- modification ;
- copie ;
- rejeu ;
- fuite d’informations ;
- utilisation hors événement ;
- utilisation hors session ;
- utilisation après révocation.

## 11.8 Offline security

- données minimales ;
- durée de validité limitée ;
- chiffrement local si nécessaire ;
- device revocation ;
- snapshot versionné ;
- opérations signées ou contextualisées selon le modèle retenu ;
- résolution côté serveur ;
- nettoyage après expiration.

## 11.9 Secrets et logs

Ne jamais logger :

- mot de passe ;
- refresh token ;
- access token complet ;
- secret MFA ;
- cookie complet ;
- clé Redis ;
- chaîne PostgreSQL avec mot de passe ;
- payload QR sensible ;
- données personnelles non nécessaires.

---

# 12. Architecture cible

## 12.1 Style

**Monolithe modulaire** avec frontières fortes.

Objectifs :

- développement rapide ;
- déploiement simplifié ;
- transactions locales ;
- modularité claire ;
- possibilité d’extraire certains modules plus tard ;
- réduction de la complexité distribuée prématurée.

## 12.2 Structure générale du repository

```text
Eventini/
├── web/                 # Next.js
├── backend/             # NestJS
├── mobile/              # Flutter, phase ultérieure
├── docs/
│   ├── 00-project-context/
│   ├── architecture/
│   ├── adr/
│   ├── api/
│   ├── database/
│   ├── security/
│   ├── modules/
│   ├── operations/
│   ├── testing/
│   └── sprints/
├── docker/
├── scripts/
└── .github/workflows/
```

## 12.3 Backend NestJS

Modules cibles :

```text
src/
├── modules/
│   ├── identity/
│   ├── organizations/
│   ├── users/
│   ├── events/
│   ├── sessions/
│   ├── participants/
│   ├── registrations/
│   ├── tickets/
│   ├── scanners/
│   ├── attendance/
│   ├── reporting/
│   ├── notifications/
│   ├── audit/
│   └── platform-administration/
├── infrastructure/
│   ├── database/
│   ├── redis/
│   ├── queues/
│   ├── logging/
│   ├── metrics/
│   ├── health/
│   ├── mail/
│   └── storage/
├── common/
└── config/
```

Chaque module doit tendre vers des couches explicites :

- domain ;
- application ;
- infrastructure ;
- presentation/API.

Les noms peuvent varier, mais la séparation des responsabilités doit rester claire.

## 12.4 Frontend Next.js

Principes :

- App Router ;
- layouts séparés par acteur ;
- server/client components utilisés intentionnellement ;
- TanStack Query pour état serveur ;
- Zustand uniquement pour état client réellement global ;
- React Hook Form + Zod ;
- TanStack Table pour listes ;
- Dexie pour offline web scanner si retenu ;
- `next-intl` pour i18n ;
- shadcn/Base UI pour composants accessibles ;
- routes centralisées ;
- API client unique ;
- gestion cohérente des erreurs.

## 12.5 Mobile Flutter

Le mobile scanner ne doit être commencé qu’après stabilisation :

- contrats auth scanner ;
- modèle scanner device ;
- ticket/QR ;
- attendance API ;
- idempotency ;
- offline sync ;
- résolution de conflits.

## 12.6 Communication temps réel

Le système doit éviter de dupliquer les règles métier dans les transports temps réel.

Le workflow métier produit un événement interne après commit. Un adaptateur SSE ou Socket.IO diffuse ensuite l’information.

## 12.7 Jobs asynchrones

BullMQ est utilisé pour :

- emails ;
- imports lourds ;
- exports ;
- génération de rapports ;
- traitements de fichiers ;
- notifications ;
- tâches de nettoyage ;
- retries contrôlés.

Chaque job doit avoir :

- identifiant stable ;
- payload versionné ;
- idempotence ;
- retry ;
- backoff ;
- logs ;
- métriques ;
- politique d’échec définitif.

---

# 13. Conventions API

## 13.1 Versioning

Préfixe cible :

```text
/api/v1
```

## 13.2 Familles de routes

Exemples de séparation :

```text
/api/v1/super-admin/...
/api/v1/admin/organizations/:organizationId/...
/api/v1/admin/events/:eventId/...
/api/v1/scanner/...
/api/v1/auth/...
/api/v1/public/...
```

La séparation de route améliore la lisibilité, mais ne remplace jamais les guards.

## 13.3 Format de succès

```json
{
  "data": {},
  "meta": {
    "requestId": "req_...",
    "timestamp": "2026-07-30T12:00:00.000Z"
  }
}
```

## 13.4 Format d’erreur

```json
{
  "error": {
    "code": "EVENT_NOT_ACTIVE",
    "message": "The event is not active.",
    "details": {}
  },
  "meta": {
    "requestId": "req_...",
    "timestamp": "2026-07-30T12:00:00.000Z"
  }
}
```

## 13.5 Pagination

Pour les grandes listes, préférer la pagination cursor-based.

Exemple conceptuel :

```json
{
  "data": [],
  "meta": {
    "page": {
      "nextCursor": "opaque_cursor",
      "previousCursor": null,
      "hasNext": true,
      "hasPrevious": false
    }
  }
}
```

Le curseur doit être opaque.

## 13.6 Idempotency

Les endpoints critiques acceptent :

```text
Idempotency-Key: <uuid-or-opaque-key>
```

Le backend doit vérifier :

- même clé + même payload : renvoyer le résultat initial ;
- même clé + payload différent : conflit ;
- clé expirée : appliquer la politique définie ;
- traitement concurrent : verrou ou contrainte sûre.

## 13.7 Concurrency control

Pour certaines ressources modifiables :

- champ `version` ;
- ETag / `If-Match` si retenu ;
- optimistic concurrency ;
- réponse `409 Conflict` ou `412 Precondition Failed`.

## 13.8 Request correlation

Chaque requête possède un `requestId` :

- reçu d’un proxy de confiance ou généré ;
- renvoyé au client ;
- propagé dans les logs ;
- propagé dans les jobs et événements internes.

---

# 14. Modèle de données conceptuel

Les tables exactes doivent être définies dans la spécification DB, mais le socle couvre au minimum :

## 14.1 Identité

- `users`
- `user_credentials`
- `user_sessions`
- `refresh_token_rotations`
- `password_reset_tokens`
- `email_verification_tokens`
- `mfa_methods`
- `recovery_codes`
- `security_events`

## 14.2 Organisations et autorisation

- `organizations`
- `organization_memberships`
- `roles`
- `permissions`
- `role_permissions`
- `membership_role_assignments`
- `platform_role_assignments`
- `event_user_assignments`
- `invitations`

## 14.3 Événements

- `events`
- `event_days` si nécessaire
- `event_sessions`
- `event_settings`

## 14.4 Participants et inscriptions

- `participants`
- `registrations`
- `registration_sessions`
- `participant_types` ou enum selon besoin
- `participant_import_jobs`
- `participant_import_rows`

## 14.5 Tickets et scanners

- `tickets`
- `ticket_tokens` ou métadonnées sécurisées
- `scanner_devices`
- `scanner_assignments`
- `scanner_sessions`

## 14.6 Attendance

- `attendance_records`
- `attendance_sync_batches`
- `attendance_sync_operations`
- `attendance_anomalies`

## 14.7 Support

- `audit_logs`
- `outbox_events` si pattern outbox retenu
- `idempotency_records`
- `notification_deliveries`
- `export_jobs`

## 14.8 Champs transverses

Lorsque pertinent :

- `id`
- `created_at`
- `created_by`
- `updated_at`
- `updated_by`
- `deleted_at`
- `deleted_by`
- `version`

Le soft delete ne doit pas être appliqué mécaniquement à toutes les tables. Les journaux immuables et certaines tables techniques nécessitent une politique spécifique.

---

# 15. Observabilité et exploitation

## 15.1 Logs Pino

Niveaux utilisés intentionnellement :

- `trace` : diagnostic très détaillé, rarement activé ;
- `debug` : informations de développement ;
- `info` : événements normaux importants ;
- `warn` : situation anormale récupérable ;
- `error` : échec opérationnel ;
- `fatal` : impossibilité de continuer correctement.

Contexte recommandé :

- requestId ;
- userId ;
- organizationId ;
- membershipId ;
- eventId ;
- sessionId ;
- scannerDeviceId ;
- jobId ;
- module ;
- action ;
- durationMs.

## 15.2 Health checks

Routes cibles :

```text
/health/live
/health/ready
/health/startup
```

### Liveness

Vérifie que le processus répond.

### Readiness

Vérifie les dépendances nécessaires :

- PostgreSQL ;
- Redis selon politique ;
- queues critiques ;
- migrations compatibles ;
- services indispensables.

### Startup

Indique si l’application a terminé son initialisation.

## 15.3 Métriques

Exemples :

- requêtes HTTP ;
- latence ;
- erreurs ;
- connexions DB ;
- erreurs Redis ;
- jobs queued/failed/completed ;
- emails failed ;
- check-ins success/refused ;
- sync offline ;
- QR invalid/replayed ;
- scanners actifs ;
- sessions actives.

---

# 16. Stratégie de tests

## 16.1 Unit tests

- use cases ;
- services domaine ;
- policies ;
- validation ;
- guards ;
- mapping ;
- utilitaires cryptographiques ;
- règles QR ;
- règles d’idempotence.

## 16.2 Integration tests

- Prisma + PostgreSQL réel ;
- Redis réel ;
- repositories ;
- transactions ;
- migrations ;
- BullMQ ;
- email adapters simulés ou sandbox.

## 16.3 E2E backend

- login ;
- refresh ;
- logout ;
- CSRF ;
- tenant isolation ;
- permissions ;
- invitations ;
- création event ;
- import ;
- check-in ;
- duplicate check-in ;
- offline sync ;
- scanner revoked ;
- organization suspended.

## 16.4 Frontend tests

- composants ;
- formulaires ;
- erreurs ;
- guards UX ;
- tables ;
- flows Playwright.

## 16.5 Tests de sécurité

- brute force ;
- CSRF ;
- IDOR/BOLA ;
- mass assignment ;
- injection ;
- XSS ;
- refresh token reuse ;
- session revocation ;
- cross-tenant access ;
- replay QR ;
- replay idempotency ;
- offline conflict.

Une suite qui ne contient que des `TODO` ne prouve rien.

---

# 17. État réel actuel du repository

> Cette section décrit le snapshot d’audit partagé le 30 juillet 2026. Elle doit être mise à jour après chaque étape importante.

## 17.1 Diagnostic global

Le repository est actuellement un **squelette d’architecture**, pas encore une application Eventini fonctionnelle complète.

## 17.2 Backend actuel

- NestJS démarre ;
- `AppModule` importe principalement `IdentityModule` ;
- plusieurs sous-modules identity sont déclarés ;
- beaucoup de controllers, services, guards et use cases sont vides ;
- les routes d’authentification ne sont pas réellement exposées ;
- Prisma est installé mais aucun `schema.prisma` complet n’est vérifié ;
- aucune migration métier réelle n’est vérifiée ;
- Redis, BullMQ, Pino, Terminus et Prometheus sont installés mais non câblés de manière complète ;
- les modules métier sont surtout des dossiers ou index sans implémentation.

## 17.3 Frontend actuel

- Next.js App Router ;
- groupes de routes auth/admin/super-admin/scanner/public ;
- API client générique ;
- hooks et types d’auth partiels ;
- plusieurs formulaires ou composants sont encore vides ;
- certains imports/types sont cassés ;
- les providers ne sont pas tous montés ;
- les guards frontend ne sont pas une vraie protection ;
- la sidebar et plusieurs briques UI existent mais ne prouvent pas les features métier.

## 17.4 Infrastructure actuelle

Non vérifié comme fonctionnel :

- Dockerfile ;
- docker-compose ;
- CI/CD ;
- health checks actifs ;
- logging Pino actif ;
- migrations DB ;
- projet Flutter.

## 17.5 Interprétation correcte

Un package installé signifie seulement qu’une capacité est disponible.

Il ne signifie pas que :

- le module est câblé ;
- la configuration est sûre ;
- une route existe ;
- un test est réel ;
- une feature est terminée ;
- une dépendance est utilisée ;
- le comportement fonctionne en production.

---

# 18. Ordre chronologique d’implémentation

L’ordre canonique est le suivant.

## Phase 0 — Stabilisation

1. rendre frontend et backend compilables ;
2. corriger imports, barrels et artefacts générés ;
3. obtenir lint, typecheck et build verts ;
4. nettoyer les tests trompeurs.

## Phase 1 — Bootstrap backend

5. ConfigModule ;
6. validation stricte des variables ;
7. prefix `/api/v1` ;
8. Helmet ;
9. CORS ;
10. cookie parser ;
11. ValidationPipe ;
12. exception filter ;
13. réponse API uniforme ;
14. Swagger minimal.

## Phase 2 — Infrastructure locale

15. Docker Compose ;
16. PostgreSQL ;
17. Redis ;
18. pgAdmin ;
19. `.env.example` ;
20. scripts de démarrage ;
21. tests de connexion.

## Phase 3 — Base de données

22. `schema.prisma` ;
23. modèles identité et organisations ;
24. rôles et permissions ;
25. sessions ;
26. security events ;
27. audit logs ;
28. migration initiale ;
29. seed sécurisé ;
30. tests DB.

## Phase 4 — Infrastructure applicative

31. PrismaModule ;
32. repositories ;
33. transactions ;
34. logging Pino ;
35. request context ;
36. audit minimal ;
37. health checks ;
38. métriques de base.

## Phase 5 — Authentification

39. Argon2id ;
40. login ;
41. access token ;
42. session serveur ;
43. refresh token ;
44. rotation ;
45. reuse detection ;
46. logout ;
47. logout all ;
48. current user ;
49. password reset ;
50. MFA ensuite.

## Phase 6 — Sécurité web

51. CSRF ;
52. Origin checks ;
53. cookies sécurisés ;
54. rate limiting ;
55. lockout ;
56. tests négatifs.

## Phase 7 — Multi-tenant et autorisation

57. organizations ;
58. memberships ;
59. tenant context ;
60. roles ;
61. permissions ;
62. event assignments ;
63. guards scoped ;
64. tests cross-tenant.

## Phase 8 — Frontend auth

65. providers ;
66. login ;
67. logout ;
68. session refresh ;
69. current user ;
70. role-aware navigation ;
71. erreurs ;
72. MFA ;
73. sessions management.

## Phase 9 — Administration organisation

74. organizations CRUD contrôlé ;
75. invitations ;
76. members ;
77. role assignments ;
78. suspension/revocation ;
79. audit UI.

## Phase 10 — Events et Sessions

80. events ;
81. transitions d’état ;
82. multi-day ;
83. sessions ;
84. check-in windows ;
85. affectations.

## Phase 11 — Participants et Registrations

86. participants ;
87. imports ;
88. déduplication ;
89. registrations ;
90. affectation sessions ;
91. exports.

## Phase 12 — Tickets, QR et Scanners

92. tickets ;
93. QR sécurisé ;
94. révocation ;
95. scanner devices ;
96. scanner assignments ;
97. activation scanner.

## Phase 13 — Attendance

98. check-in online ;
99. idempotency ;
100. duplicate handling ;
101. check-out ;
102. anomalies ;
103. audit.

## Phase 14 — Offline et Realtime

104. modèle offline ;
105. batch sync ;
106. conflict resolution ;
107. SSE dashboard ;
108. présence scanners ;
109. tests réseau instable.

## Phase 15 — Notifications et Reporting

110. BullMQ ;
111. emails ;
112. retry ;
113. exports ;
114. rapports ;
115. métriques métier.

## Phase 16 — Production readiness

116. Dockerfiles ;
117. CI/CD ;
118. tests complets ;
119. sécurité ;
120. sauvegardes ;
121. monitoring ;
122. runbooks ;
123. load tests ;
124. release process.

## Phase 17 — Flutter

125. application scanner mobile ;
126. secure storage ;
127. offline database ;
128. scan QR ;
129. sync ;
130. device management ;
131. distribution.

---

# 19. Définition de Done

Une fonctionnalité n’est `DONE` que si les éléments applicables sont présents :

- besoin métier compris ;
- règles documentées ;
- modèle DB ;
- migration ;
- contraintes et index ;
- use case ;
- repository ;
- route/API ;
- DTO validation ;
- authorization ;
- tenant isolation ;
- audit/security events ;
- gestion d’erreurs ;
- tests unitaires ;
- tests d’intégration ;
- tests E2E ;
- documentation API ;
- frontend connecté ;
- observabilité ;
- build vert ;
- preuve d’exécution.

Statuts recommandés :

- `MISSING` : absent ;
- `SKELETON` : structure sans logique ;
- `PARTIAL` : comportement incomplet ;
- `BROKEN` : existe mais ne fonctionne pas ;
- `IMPLEMENTED` : code présent mais validation incomplète ;
- `DONE` : critères d’acceptation satisfaits ;
- `DEFERRED` : volontairement reporté.

---

# 20. Non-objectifs initiaux

Sauf décision explicite, ne pas implémenter trop tôt :

- microservices ;
- Kubernetes ;
- event sourcing complet ;
- CQRS généralisé ;
- GraphQL ;
- moteur de billing complexe ;
- marketplace ;
- participant social network ;
- biométrie ;
- reconnaissance faciale ;
- blockchain ;
- IA générative métier ;
- système de badges complexe ;
- personnalisation white-label avancée ;
- multi-région active-active ;
- application Flutter avant stabilisation backend.

Ces éléments peuvent être étudiés plus tard, mais ne doivent pas perturber le MVP robuste.

---

# 21. Règles obligatoires pour un agent IA

Tout agent travaillant sur Eventini doit :

1. lire ce document avant de modifier le code ;
2. inspecter l’état réel du repository ;
3. distinguer `target`, `existing`, `partial` et `missing` ;
4. ne jamais déclarer une feature terminée sur la base des noms de dossiers ;
5. conserver l’architecture monolithe modulaire ;
6. respecter les frontières de modules ;
7. ne pas accéder à Prisma directement depuis les controllers ;
8. ne pas placer la logique d’autorisation dans le frontend ;
9. vérifier tenant + membership + permission + resource scope ;
10. utiliser PostgreSQL pour les données durables ;
11. utiliser Redis seulement pour les données temporaires ;
12. produire des migrations explicites ;
13. éviter les mocks dans les flows considérés comme terminés ;
14. écrire les tests avant de déclarer `DONE` ;
15. ne pas ignorer les erreurs TypeScript, lint ou build ;
16. ne pas modifier massivement le code hors scope ;
17. ne pas ajouter une dépendance sans justification ;
18. ne pas stocker de secret dans le code ou les logs ;
19. préserver la compatibilité des contrats API ;
20. lister les fichiers modifiés ;
21. exécuter les commandes de validation ;
22. donner les résultats exacts ;
23. signaler les éléments impossibles à vérifier ;
24. documenter les décisions d’architecture importantes ;
25. proposer l’étape suivante cohérente avec l’ordre chronologique.

---

# 22. Format attendu des rapports d’agent

Après chaque intervention, l’agent doit fournir :

## Scope traité

Ce qui était inclus et exclu.

## État initial vérifié

Fichiers et comportements observés.

## Modifications

Liste précise des fichiers et changements.

## Décisions

Choix et justification.

## Sécurité

Contrôles ajoutés, impacts et risques restants.

## Base de données

Schéma, migration, index et contraintes.

## Tests exécutés

Commandes et résultats réels.

## Validation

- lint ;
- typecheck ;
- unit ;
- integration ;
- E2E ;
- build ;
- start/smoke test.

## État final

Tableau :

| Élément | Avant | Après | Preuve |
|---|---|---|---|

## Limitations

Tout élément incomplet ou non vérifiable.

## Prochaine étape

Une seule prochaine étape logique, alignée avec ce document.

---

# 23. Glossaire

- **Tenant** : organisation cliente isolée logiquement.
- **Membership** : relation entre un utilisateur et une organisation.
- **Scoped authorization** : autorisation dépendant d’un contexte précis.
- **Scanner** : utilisateur ou appareil opérant le check-in.
- **Scanner device** : appareil enregistré et contrôlé.
- **Registration** : inscription d’un participant à un événement.
- **Ticket** : droit d’accès représentable par QR code.
- **Attendance record** : enregistrement de présence.
- **Check-in** : validation d’entrée.
- **Check-out** : validation de sortie.
- **Idempotency** : garantie qu’un rejeu ne produit pas un effet supplémentaire.
- **Anti-replay** : mécanisme empêchant la réutilisation abusive d’une preuve.
- **Kill-switch** : blocage d’urgence d’une organisation, d’un événement ou d’une capacité.
- **Security event** : événement lié à la sécurité.
- **Audit log** : trace métier ou administrative durable.
- **Source of truth** : système de référence autoritaire.
- **Fail closed** : refus par défaut lorsque la sécurité ne peut pas être prouvée.

---

# 24. Résumé opérationnel pour l’agent

Eventini est un SaaS multi-tenant de gestion d’événements et de check-in.

Le cœur du produit est :

```text
Platform
  → Organizations
    → Memberships and scoped permissions
      → Events
        → Sessions
          → Participants and registrations
            → Tickets and QR codes
              → Scanner assignments
                → Online/offline attendance
                  → Realtime, reports and audit
```

L’ordre de construction est :

```text
Build propre
→ Bootstrap sécurisé
→ PostgreSQL/Redis
→ Prisma et migrations
→ Logging/audit/health
→ Auth
→ CSRF/rate limit
→ Multi-tenant
→ Scoped authorization
→ Frontend auth
→ Organizations
→ Events
→ Participants
→ QR/scanners
→ Attendance
→ Offline/realtime
→ Reporting/notifications
→ Production readiness
→ Flutter
```

À la date du présent document, le repository contient surtout la structure et les dépendances. L’agent doit donc construire les fondations avant les features métier et ne jamais confondre architecture préparée avec fonctionnalité terminée.
