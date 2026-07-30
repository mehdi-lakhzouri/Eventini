# ADR-0015 — Portée du rôle `SCANNER`

| | |
|---|---|
| **Statut** | Accepté |
| **Date** | 2026-07-30 |
| **Contradiction résolue** | **C-17** (choix laissé ouvert par le Document A §6.5) |
| **Impacte** | `roles`, `event_user_assignments`, `scanner_device_assignments`, guards du module attendance |

## Contexte

Le Document A §6.5 fixe `SUPER_ADMIN → PLATFORM` et `CLIENT_ADMIN → ORGANIZATION`, puis laisse le troisième cas ouvert : `SCANNER` → « `ORGANIZATION` ou `EVENT` selon la stratégie retenue ».

Ce n'est pas un détail de nommage. Le contexte produit §6.3 impose qu'un scanner ait un « accès limité aux événements et sessions affectés » et « aucune gestion globale des participants ». Un rôle de portée `ORGANIZATION` donnerait mécaniquement accès à tous les événements de l'organisation.

## Décision

**`SCANNER` a la portée `EVENT`.**

L'autorisation d'un opérateur de scan exige **trois** conditions simultanées, toutes vérifiées côté serveur :

| # | Condition | Table |
|---|---|---|
| 1 | Membership `ACTIVE` dans l'organisation | `organization_memberships` |
| 2 | Assignation événementielle non révoquée, dans sa fenêtre de validité | `event_user_assignments` avec `assignment_type = 'SCANNER'` |
| 3 | Appareil enregistré, `ACTIVE`, assigné à cet événement | `scanner_devices` + `scanner_device_assignments` |

Une restriction supplémentaire par session d'événement est portée par `scanner_device_assignments` : un scanner peut être limité à un sous-ensemble de `event_sessions` (un atelier, une zone, une journée).

Les permissions `attendance.check_in` et `attendance.override` sont donc **toujours** de portée `EVENT` et ne sont jamais accordées par un rôle d'organisation.

Conséquence directe : la révocation d'un appareil perdu ne nécessite pas de toucher au membership. Révoquer `scanner_device_assignments` suffit à couper l'accès opérationnel, ce qui est exactement le comportement attendu par le contexte produit §6.3 (« appareil ou session scanner révocable »).

## Conséquences

**Positives** — l'appartenance à une organisation ne donne aucun droit de scan ; le périmètre est explicite, borné dans le temps et révocable à trois niveaux indépendants (membership, assignation événementielle, appareil) ; correspond au modèle d'un prestataire recruté pour un seul événement.

**Négatives** — assigner un scanner sur 10 événements demande 10 assignations ; c'est un coût d'administration réel, atténué par une action d'assignation groupée côté UI (sprint 11), pas par un élargissement de portée.

## Alternatives rejetées

- **`SCANNER` de portée `ORGANIZATION`** — une seule assignation, administration plus légère. Rejeté : un prestataire recruté pour un événement obtiendrait l'accès de scan à tous les événements de l'organisation, y compris ceux à venir. Violation directe du contexte produit §6.3.
- **Double rôle (`ORGANIZATION` + restriction événementielle optionnelle)** — flexible, mais fait du chemin le plus large le chemin par défaut. La règle de sécurité doit être restrictive par défaut, pas restrictive sur option.

## Vérification

Test e2e : un opérateur assigné à l'événement A tente un check-in sur l'événement B de la **même** organisation, avec un ticket valide ⇒ `403 AUTH_PERMISSION_DENIED`, security event `TENANT_ACCESS_DENIED`.
