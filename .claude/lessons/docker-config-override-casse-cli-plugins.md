# Leçon — Surcharger DOCKER_CONFIG casse la découverte des plugins CLI docker (dont compose)

**Date** : 2026-07-11 · **Contexte** : intégration F0, couture INFRA-003 ↔ INFRA-002 · **Classe** : environnement de test Docker

## Symptôme
Après merge d'INFRA-003, tous les tests compose d'INFRA-002 échouaient sous vitest (« docker compose config a échoué », « container introuvable ») alors que `docker compose` fonctionnait hors vitest et que les tests Testcontainers passaient.

## Cause racine (double)
`tools/ci/vitest.config.ts` injectait `DOCKER_CONFIG` vers un répertoire temporaire (contournement légitime du credsStore `desktop` absent du PATH). Or :
1. Le config temporaire déclarait `currentContext: "desktop-linux"` sans le répertoire `contexts/` → le CLI ne résolvait plus l'endpoint du daemon.
2. Quand `DOCKER_CONFIG` est surchargé, docker ne cherche les plugins CLI **que** dans `$DOCKER_CONFIG/cli-plugins` → le plugin `compose` de `~/.docker/cli-plugins` n'était plus découvert ; `docker compose` devenait une sous-commande inconnue.

## Règle à appliquer désormais
Tout `DOCKER_CONFIG` temporaire de test doit : (a) omettre `currentContext`, (b) créer `cli-plugins/` et y symlinker les plugins nécessaires depuis `~/.docker/cli-plugins/` (au minimum `docker-compose`). Vérifier les DEUX consommateurs (CLI compose ET Testcontainers) avant de valider — un contournement d'environnement qui aide une suite peut en casser une autre du même workspace.

## Enforcement
Consigné ici + le fix de référence est `tools/ci/vitest.config.ts` (fonction `createDockerConfig`). Si un 2e cas survient dans un autre workspace : extraire le helper dans `@sigfa/testing` et ajouter un check au gate.
